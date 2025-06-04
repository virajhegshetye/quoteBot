const { BotFrameworkAdapter, MemoryStorage, ConversationState, ActivityHandler } = require('botbuilder');
const { SpeechConfig, AudioConfig, SpeechRecognizer, SpeechSynthesizer } = require('microsoft-cognitiveservices-speech-sdk');
const axios = require('axios');
const { CallAutomationClient } = require('@azure/communication-call-automation');
const restify = require('restify');
require('dotenv').config();

// Adapter setup
const adapter = new BotFrameworkAdapter({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Conversation state
const memoryStorage = new MemoryStorage();
const conversationState = new ConversationState(memoryStorage);
const userProfile = conversationState.createProperty('userProfile');

// Azure Speech Service
const speechConfig = SpeechConfig.fromSubscription(process.env.SPEECH_KEY, process.env.SPEECH_REGION);
const audioConfig = AudioConfig.fromDefaultMicrophoneInput();

// Azure Communication Services
const acsClient = new CallAutomationClient(process.env.ACS_CONNECTION_STRING);

// Bot logic
class QuotationBot extends ActivityHandler {
    constructor(conversationState, userProfile, speechConfig) {
        super();
        this.conversationState = conversationState;
        this.userProfile = userProfile;
        this.speechConfig = speechConfig;

        this.onMessage(async (context, next) => {
            const state = await this.userProfile.get(context, { step: 'start', data: {} });

            async function sendAndSpeak(message) {
                await context.sendActivity(message);
                const synthesizer = new SpeechSynthesizer(speechConfig);
                await synthesizer.speakTextAsync(message);
            }

            if (state.step === 'start') {
                await sendAndSpeak('Hello! Please tell me your first name.');
                state.step = 'firstName';
            } else if (state.step === 'firstName') {
                state.data.name = context.activity.text;
                await sendAndSpeak(`Got it, ${state.data.name}. Now, please tell me your monthly income?.`);
                state.step = 'income';
            }
            //   else if (state.step === 'lastName') {
            //     state.data.lastName = context.activity.text;
            //     await sendAndSpeak(`Thanks, ${state.data.lastName}. What is your monthly income?`);
            //     state.step = 'income';
            //   }
            else if (state.step === 'income') {
                state.data.income = parseFloat(context.activity.text);
                const confirmationMessage = `Please confirm: First Name: ${state.data.name}, Monthly Income: $${state.data.income}. Say "yes" to confirm or "no" to restart.`;
                await sendAndSpeak(confirmationMessage);
                state.step = 'confirm';
            } else if (state.step === 'confirm') {
                if (context.activity.text.toLowerCase() === 'yes') {
                    try {
                        const response = await axios.post(`https://mock-quote-api-asgnetbfdhf6eqhn.southeastasia-01.azurewebsites.net/api/creditcard/apply`, state.data,
                            {
                                headers: {
                                  'Content-Type': 'application/json'
                                }
                              }
                            );
                        const status = response.data.decision;
                        await sendAndSpeak(`Your application has been ${status} for a card. Thank you!`);
                        state.step = 'start';
                        state.data = {};
                    } catch (error) {
                        console.log(`error:::`,error);
                        
                        await sendAndSpeak('Sorry, there was an error processing your request. Please try again.');
                    }
                } else {
                    await sendAndSpeak('Let’s start over. Please tell me your first name.');
                    state.step = 'start';
                    state.data = {};
                }
            }

            await this.conversationState.saveChanges(context);
            await next();
        });
    }
}

const bot = new QuotationBot(conversationState, userProfile, speechConfig);

// Create server
const server = restify.createServer();
server.listen(process.env.PORT || 3978, () => {
    console.log(`Server running at ${server.url}`);
});

// Bot endpoint

server.post('/api/messages', async (req, res) => {
    await adapter.processActivity(req, res, async (context) => {
        await bot.run(context);
    });
});


// ACS call handler
server.post('/api/calls', async (req, res) => {
    const callData = req.body;
    if (callData.event === 'CallConnected') {
        const callConnectionId = callData.data.callConnectionId;
        const callConnection = acsClient.getCallConnection(callConnectionId);
        await callConnection.playText({ text: 'Hello! Please tell me your first name.' });
    }
    res.status(200).send();
});

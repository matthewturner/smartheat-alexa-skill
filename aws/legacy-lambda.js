const DefaultThermostatRepository = require('@matthewturner/smartheat-core/core/ThermostatRepository');
const DefaultHoldStrategy = require('@matthewturner/smartheat-core/core/HoldStrategy');
const SetTemperatureStrategy = require('@matthewturner/smartheat-core/core/SetTemperatureStrategy');
const ThermostatService = require('@matthewturner/smartheat-core/core/ThermostatService');
const WaterService = require('@matthewturner/smartheat-core/core/WaterService');
const DefaultsService = require('@matthewturner/smartheat-core/core/DefaultsService');
const Logger = require('@matthewturner/smartheat-core/core/Logger');
const DynamodbThermostatRepository = require('@matthewturner/smartheat-aws/aws/ThermostatRepository');
const helpers = require('@matthewturner/smartheat-aws/aws/helpers');
const AwsHoldStrategy = require('@matthewturner/smartheat-aws/aws/HoldStrategy');
const Factory = require('@matthewturner/smartheat-core/core/Factory');

const Alexa = require('ask-sdk-core');
const { version } = require('../package.json');

const controlService = (request, serviceType = ThermostatService, logger = new Logger(process.env.LOG_LEVEL || Logger.DEBUG)) => {
    logger.debug(`SmartHome Version: ${version}`);

    const userId = request.userId || request.session.user.userId;
    const shortUserId = helpers.truncateUserId(userId);
    logger.prefix = shortUserId;
    let source = 'user';
    if (!request.context) {
        source = 'callback';
    }
    const context = {
        userId: userId,
        shortUserId: shortUserId,
        source: source
    };
    logger.debug(`Creating context for source: ${context.source}...`);
    const repository = createRepository(logger);
    const holdStrategy = createHoldStrategy(logger, context);
    const setTemperatureStrategy = new SetTemperatureStrategy(logger);
    const factory = new Factory(logger);
    const service = new serviceType(logger, context, factory, repository,
        holdStrategy, setTemperatureStrategy);
    return {
        logger,
        service
    };
};

const createHoldStrategy = (logger, context) => {
    if (process.env.HOLD_STRATEGY === 'aws') {
        return new AwsHoldStrategy(logger, context);
    }
    return new DefaultHoldStrategy(logger, context);
};

const createRepository = (logger) => {
    if (process.env.THERMOSTAT_REPOSITORY === 'dynamodb') {
        return new DynamodbThermostatRepository(logger);
    }
    return new DefaultThermostatRepository(logger);
};

const say = (responseBuilder, output, logger) => {
    const {
        messages,
        card
    } = output;
    let text = '';
    if (messages instanceof Array) {
        for (const message of messages) {
            logger.debug(message);
        }
        responseBuilder.speak(messages.join(' '));
        text = messages.join('\n');
    } else {
        responseBuilder.speak(messages);
        text += messages;
        logger.debug(messages);
    }

    return responseBuilder
        .withStandardCard(card.title, text, card.image.smallImageUrl, card.image.largeImageUrl)
        .getResponse();
};

const report = (responseBuilder, message, logger) => {
    responseBuilder.speak(message);
    logger.error(message);
    return responseBuilder.getResponse();
};

const reportOn = async (handlerInput, serviceType, action) => {
    const {
        logger,
        service
    } = controlService(handlerInput.requestEnvelope, serviceType);
    try {
        const output = await action(service);
        return say(handlerInput.responseBuilder, output, logger);
    } catch (e) {
        return report(handlerInput.responseBuilder, e.message, logger);
    }
};

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, ThermostatService,
            service => service.launch());
    }
};

const TempIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TempIntent';
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, ThermostatService,
            service => service.status());
    }
};

const TurnUpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnUpIntent';
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, ThermostatService,
            service => service.turnUp());
    }
};

const TurnDownIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnDownIntent';
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, ThermostatService,
            service => service.turnDown());
    }
};

const SetTempIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetTempIntent';
    },
    async handle(handlerInput) {
        const temp = Alexa.getSlotValue(handlerInput.requestEnvelope, 'temp');
        const targetTemp = parseFloat(temp);
        const optionalDuration = Alexa.getSlotValue(handlerInput.requestEnvelope, 'duration');

        return await reportOn(handlerInput, ThermostatService,
            service => service.setTemperature(targetTemp, optionalDuration));
    }
};

const TurnIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnIntent';
    },
    async handle(handlerInput) {
        const onOff = Alexa.getSlotValue(handlerInput.requestEnvelope, 'onoff');
        const duration = Alexa.getSlotValue(handlerInput.requestEnvelope, 'duration');

        // this could be a callback from a step function
        return await reportOn(handlerInput, ThermostatService,
            service => {
                if (onOff === 'on') {
                    return service.turnOn(duration);
                } else {
                    return service.turnOff();
                }
            });
    }
};

const TurnWaterIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'TurnWaterIntent';
    },
    async handle(handlerInput) {
        const onOff = Alexa.getSlotValue(handlerInput.requestEnvelope, 'onoff') || 'on';
        const duration = Alexa.getSlotValue(handlerInput.requestEnvelope, 'duration');

        return await reportOn(handlerInput, WaterService,
            service => {
                if (onOff === 'on') {
                    return service.turnOn(duration);
                } else {
                    return service.turnOff();
                }
            });
    }
};

const SetDefaultIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetDefaultTempIntent';
    },
    async handle(handlerInput) {
        const onOff = Alexa.getSlotValue(handlerInput.requestEnvelope, 'onoff');
        const temp = parseFloat(Alexa.getSlotValue(handlerInput.requestEnvelope, 'temp'));

        return await reportOn(handlerInput, DefaultsService,
            service => service.setDefault(onOff, temp));
    }
};

const SetDefaultDurationIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetDefaultDurationIntent';
    },
    async handle(handlerInput) {
        const duration = Alexa.getSlotValue(handlerInput.requestEnvelope, 'duration');

        return await reportOn(handlerInput, DefaultsService,
            service => service.setDefault('duration', duration));
    }
};

const DefaultsIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'DefaultsIntent';
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, DefaultsService,
            service => service.defaults());
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        let helpOutput = 'You can say \'set the temperature to 18 degrees\' or ask \'the temperature\'. You can also say stop or exit to quit.';
        let reprompt = 'What would you like to do?';

        return handlerInput.responseBuilder
            .speak(helpOutput)
            .reprompt(reprompt)
            .withSimpleCard(reprompt, helpOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {
        return await reportOn(handlerInput, ThermostatService,
            service => service.turnOff());
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.message}`);

        return handlerInput.responseBuilder
            .speak('Sorry, I don\'t understand your command. Please say it again.')
            .reprompt('Sorry, I don\'t understand your command. Please say it again.')
            .getResponse();
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        TempIntentHandler,
        TurnUpIntentHandler,
        TurnDownIntentHandler,
        SetTempIntentHandler,
        TurnIntentHandler,
        TurnWaterIntentHandler,
        SetDefaultIntentHandler,
        SetDefaultDurationIntentHandler,
        DefaultsIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler)
    .addErrorHandlers(ErrorHandler)
    .lambda();
"use strict"
import dotenv from "dotenv"
import express from "express"
import request from "superagent";
import bodyParser from "body-parser";
import * as winston from "winston";
import 'winston-daily-rotate-file';
import { ChatGPTAPI } from 'chatgpt'
import Keyv from 'keyv'
import KeyvRedis from '@keyv/redis'

dotenv.config()
const app = express()
app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 1000000 }));
const transport = new winston.transports.DailyRotateFile({
    filename: './logs/application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: false,
    maxSize: '20m',
    maxFiles: '7d'
});
const logger = winston.createLogger({
    transports: [
        transport
    ]
})

app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
})

const cacheOptions = {
    namespace: 'chatgpt',
    adapter: 'redis',
    store: new KeyvRedis(process.env.REDIS_CLIENT),
    // ttl: 86400000
}

let clients = [];

app.get("/status", (req, res) => res.json({ clients: clients.length }));

app.get("/events", (req, res) => {
    eventsHandler(req, res);
});

function eventsHandler(req, res) {
    const clientId = req.query.id;
    if (!clientId) {
        return res.json({ code: 1, msg: "clientId error" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const newClient = {
        id: clientId,
        response: res,
    };

    clients.push(newClient);

    req.on("close", () => {
        console.log(`${clientId} Connection closed`);
        clients = clients.filter((client) => client.id !== clientId);
    });
}
function sendEventsToAll(text, clientId) {
    clients.forEach((client) => {
      if (client.id === clientId) {
        client.response.write(`event: message\n`);
        client.response.write(`data: ${JSON.stringify({ answer: text, uuid: clientId })}\n\n`);
  
        if (text === "[DONE]") {
          client.response.end();
        }
      }
    });
  }
  

async function sendMessageAndNotify(clientId, subject, parentMessageId, systemMessage) {
    try {
        const response = await api.sendMessage(subject, {
            parentMessageId,
            systemMessage,
            onProgress: (partialResponse) => {
                sendEventsToAll(partialResponse.text, clientId);
            },
        });

        sendEventsToAll("[DONE]", clientId);

        await request
            .post(process.env.ASYBCHRONOUS_NOTIFICATION)
            .field("uuid", clientId)
            .field("content", response.text)
            .field("parent_message_id", response.id);

    } catch (err) {
        console.log(err);
        logger.error("API_ERROR_TIME:" + getCurrentTime());
        logger.error("API_ERROR:" + err.toString());
        logger.error("--------------------------------");

        sendEventsToAll("[DONE]", clientId);
    }
}

const api = new ChatGPTAPI({
    apiKey: process.env.OPENAI_API_KEY,
    messageStore: new Keyv(cacheOptions),
    // maxModelTokens: 2000
})

// const currentDate = (new Date()).toISOString().split("T")[0];
// const _systemMessage = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.
// Knowledge cutoff: 2021-09-01
// Current date: ${currentDate}
// `

app.post("/chatgpt", async (req, res) => {
    try {
        const parentMessageId = req?.body?.parent_message_id
        const clientId = req?.body?.client_id
        const systemMessage = req?.body?.system_message
        let subject = req?.body?.subject
        if (!subject) {
            return res.json({ code: 1, msg: 'subject error' })
        }
        sendMessageAndNotify(clientId, subject, parentMessageId, systemMessage);

        return res.json({ code: 0, msg: 'success' })
    } catch (err) {
        logger.error("ERROR_TIME:" + getCurrentTime())
        logger.error("ERROR:" + err.toString())
        logger.error("--------------------------------")
        console.log(err)
        return res.json({ code: 1, msg: "服务繁忙,请重试" })
    }

})



app.listen(process.env.APP_PORT, process.env.APP_HOST_NAME, function () {
    console.log(`服务器运行在http://${process.env.APP_HOST_NAME}:${process.env.APP_PORT}`);
})

function getCurrentTime() {
    var date = new Date();//当前时间
    var month = zeroFill(date.getMonth() + 1);//月
    var day = zeroFill(date.getDate());//日
    var hour = zeroFill(date.getHours());//时
    var minute = zeroFill(date.getMinutes());//分
    var second = zeroFill(date.getSeconds());//秒

    //当前时间
    var curTime = date.getFullYear() + "-" + month + "-" + day
        + " " + hour + ":" + minute + ":" + second;

    return curTime;
}

/**
 * 补零
 */
function zeroFill(i) {
    if (i >= 0 && i <= 9) {
        return "0" + i;
    } else {
        return i;
    }
}
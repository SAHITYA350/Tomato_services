import amqp from "amqplib";
import dotenv from "dotenv";
import { startOrderReadyConsumer } from "./orderReady.consumer.js";
dotenv.config();

let channel: amqp.Channel;

export const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL!);

        connection.on("error", (err) => {
            console.error("RabbitMQ connection error in rider service:", err);
        });

        connection.on("close", () => {
            console.error("RabbitMQ connection closed in rider service. Reconnecting in 5s...");
            setTimeout(connectRabbitMQ, 5000);
        });

        channel = await connection.createChannel();

        channel.on("error", (err) => {
            console.error("RabbitMQ channel error in rider service:", err);
        });

        await channel.assertQueue(process.env.RIDER_QUEUE!, {
            durable: true,
        });
        
        await channel.assertQueue(process.env.ORDER_READY_QUEUE!, {
            durable: true,
        });

        console.log("🐇 connected To Rabbitmq (rider service)");

        // Start order ready consumer
        startOrderReadyConsumer();
    } catch (error) {
        console.error("RabbitMQ initial connection failed in rider service. Reconnecting in 5s...", error);
        setTimeout(connectRabbitMQ, 5000);
    }
};

export const getChannel = () => channel;
import amqp from "amqplib";
import dotenv from "dotenv";
dotenv.config();

let channel: amqp.Channel;

export const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(process.env.RABBITMQ_URL!);

        connection.on("error", (err) => {
            console.error("RabbitMQ connection error in utils service:", err);
        });

        connection.on("close", () => {
            console.error("RabbitMQ connection closed in utils service. Reconnecting in 5s...");
            setTimeout(connectRabbitMQ, 5000);
        });

        channel = await connection.createChannel();

        channel.on("error", (err) => {
            console.error("RabbitMQ channel error in utils service:", err);
        });

        await channel.assertQueue(process.env.PAYMENT_QUEUE!, {
           durable: true
        });

        console.log("🐇 connected To Rabbitmq (utils service)");
    } catch (error) {
        console.error("RabbitMQ initial connection failed in utils service. Reconnecting in 5s...", error);
        setTimeout(connectRabbitMQ, 5000);
    }
};

export const getChannel = () => channel;
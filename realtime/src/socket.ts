import {Server} from 'socket.io'
import http from 'http'
import jwt from 'jsonwebtoken'
import { activeUsers } from './activeUsers.js'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'

let io: Server;

export const initSocket = (server: http.Server) => {
    io = new Server(server, {
        cors: {
            origin: '*',
        },
    });

    // Redis adapter setup for scaling
    if (process.env.REDIS_URL) {
        try {
            const pubClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
            const subClient = pubClient.duplicate();
            
            // Suppress initial connection errors if Redis isn't running in local dev
            pubClient.on("error", (err) => console.warn("Redis pubClient error:", err.message));
            subClient.on("error", (err) => console.warn("Redis subClient error:", err.message));
            
            io.adapter(createAdapter(pubClient, subClient));
            console.log("Redis adapter attached to Socket.io");
        } catch (err) {
            console.log("Redis failed to initialize, falling back to in-memory adapter");
        }
    } else {
        console.log("REDIS_URL not set, using default in-memory adapter");
    }

    io.use((socket, next) => {
        try {
             const token = socket.handshake.auth?.token;
             if (!token) {
                return next(new Error("Unauthorized"));
             }
             
             const decoded = jwt.verify(token, process.env.JWT_SEC!) as any

             if(!decoded || !decoded.user) {
               return next(new Error("Unauthorized"));
             }

             socket.data.user = decoded.user;

             next();

        } catch (error) {
              console.log("❌ Socket auth failed ",error);
             next(new Error("Unauthorized"));
        }
    });

    io.on('connection', (socket) => {
       const user = socket.data.user;

       if(!user){
        socket.disconnect();
        return;
       }

       const userId = user._id;
       socket.join(`user:${userId}`);
       socket.join("global");

       if(user.restaurantId) {
        socket.join(`restaurant:${user.restaurantId}`);
       }

       console.log(`User connected : ${userId}`);
       console.log("Socket room : ", [...socket.rooms]);
       
       socket.on("rider:update_location", (data) => {
           // data should contain { orderId, lat, lng, restaurantId, customerId }
           // Broadcast to the specific restaurant and customer
           if (data.restaurantId) {
               io.to(`restaurant:${data.restaurantId}`).emit("rider:location", data);
           }
           if (data.customerId) {
               io.to(`user:${data.customerId}`).emit("rider:location", data);
           }
           if (data.orderId) {
               io.to(`order:${data.orderId}`).emit("rider:location", data);
           }
       });

       socket.on("join:order", (orderId) => {
           socket.join(`order:${orderId}`);
       });

       socket.on("disconnect", () => {
        console.log(`User disconnected : ${userId}`);
        activeUsers.delete(userId);
        io.to("global").emit("user:offline", userId);
       });
    });

    return io;
};


export const getIO = () => {
    if(!io) {
       throw new Error("Socket.io not initialized");
    }

    return io;
}
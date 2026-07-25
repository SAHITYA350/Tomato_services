import mongoose, { Schema, Document } from "mongoose";

export interface IAddress extends Document {
    userId: string;
    mobile: number;
    formattedAddress: string;

    location: {
        type: string;
        coordinates: [number, number];
    };

    createdAt: Date;
    updatedAt: Date;

}


const schema = new Schema<IAddress>({
    userId: {
        type: String,
        required: true,
    },
    mobile: {
        type: Number,
        required: true,
    },
    formattedAddress: {
        type: String,
        required: true,
    },
    location: {
        type: {
            type: String,
            enum: ["Point"],
            default: "Point",
        },
        coordinates: {
            type: [Number],
            required: true,
       },
    }  
  }, {
    timestamps: true,
  }
);


schema.index({ location: "2dsphere" }); // Create a 2dsphere index on the location field

export default mongoose.model<IAddress>("Address", schema);
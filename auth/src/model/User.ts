import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
     name: string;
     email: string;
     image: string;
     role: string | null;
}

const schema: Schema<IUser> = new Schema({
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        image: { type: String, required: false },
        role: { type: String, required: false, default: null },
},{
 timestamps: true
}
);

const User = mongoose.model<IUser>("User", schema);
export default User;
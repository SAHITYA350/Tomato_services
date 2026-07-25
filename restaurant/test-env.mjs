import { spawn } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const pythonExe = "C:/Users/Sahitya/AppData/Local/Python/pythoncore-3.14-64/python.exe";
const scriptPath = path.join(process.cwd(), "scripts", "agent.py");

console.log("Starting Python script with GROQ_API_KEY:", process.env.GROQ_API_KEY ? "Set" : "Missing");

const historyJson = JSON.stringify([{ role: "user", content: "What are my active orders?" }]);

const pyProc = spawn(pythonExe, [scriptPath, historyJson, '6a22bd16638726723d057a84'], {
    env: { ...process.env }
});

let out = "";
let err = "";

pyProc.stdout.on('data', d => out += d.toString());
pyProc.stderr.on('data', d => err += d.toString());

pyProc.on('close', c => {
    console.log('Exit:', c);
    console.log('OUT:', out);
    console.error('ERR:', err);
});

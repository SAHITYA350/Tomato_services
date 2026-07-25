import { spawn } from 'child_process';
import path from 'path';

const pythonExe = "C:/Users/Sahitya/AppData/Local/Python/pythoncore-3.14-64/python.exe";
const scriptPath = path.join(process.cwd(), "scripts", "agent.py");

console.log("Starting Python script...");
const pyProc = spawn(pythonExe, [scriptPath, '[{"role": "user", "content": "hello"}]', 'some-id'], {
    env: { ...process.env }
});

pyProc.stdout.on('data', d => console.log('OUT:', d.toString()));
pyProc.stderr.on('data', d => console.error('ERR:', d.toString()));
pyProc.on('close', c => console.log('Exit:', c));
pyProc.on('error', e => console.error('Spawn Error:', e));

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface PythonScriptResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime: number;
}

export class PythonRunner {
  private pythonPath: string;

  constructor(pythonPath: string = '/Users/paul/miniforge3/bin/python') {
    this.pythonPath = pythonPath;
  }

  async runScript<T = any>(
    scriptPath: string,
    args: string[] = [],
    timeoutMs: number = 30000
  ): Promise<PythonScriptResult<T>> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let fullScriptPath = path.join(
        process.cwd(),
        'python-scripts',
        scriptPath
      );
      const apiScriptPath = path.join(
        process.cwd(),
        'src/app/api/python',
        scriptPath
      );
      if (fs.existsSync(apiScriptPath)) {
        fullScriptPath = apiScriptPath;
      }

      console.log('Running Python script:', {
        pythonPath: this.pythonPath,
        scriptPath: fullScriptPath,
        args: args,
        cwd: process.cwd()
      });

      const pythonProcess = spawn(this.pythonPath, [fullScriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        cwd: process.cwd() // Ensure we're in the project root
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        const executionTime = Date.now() - startTime;

        if (code === 0) {
          try {
            const data = stdout.trim() ? JSON.parse(stdout) : null;
            resolve({
              success: true,
              data,
              executionTime
            });
          } catch (parseError) {
            resolve({
              success: true,
              data: stdout.trim() as T,
              executionTime
            });
          }
        } else {
          resolve({
            success: false,
            error: stderr || `Process exited with code ${code}`,
            executionTime
          });
        }
      });

      pythonProcess.on('error', (error) => {
        const executionTime = Date.now() - startTime;
        resolve({
          success: false,
          error: error.message,
          executionTime
        });
      });

      pythonProcess.on('timeout', () => {
        pythonProcess.kill();
        const executionTime = Date.now() - startTime;
        resolve({
          success: false,
          error: 'Script execution timed out',
          executionTime
        });
      });
    });
  }

  async runCode<T = any>(
    code: string,
    args: string[] = [],
    timeoutMs: number = 30000
  ): Promise<PythonScriptResult<T>> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const pythonProcess = spawn(this.pythonPath, ['-c', code, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        const executionTime = Date.now() - startTime;

        if (code === 0) {
          try {
            const data = stdout.trim() ? JSON.parse(stdout) : null;
            resolve({
              success: true,
              data,
              executionTime
            });
          } catch (parseError) {
            resolve({
              success: true,
              data: stdout.trim() as T,
              executionTime
            });
          }
        } else {
          resolve({
            success: false,
            error: stderr || `Process exited with code ${code}`,
            executionTime
          });
        }
      });

      pythonProcess.on('error', (error) => {
        const executionTime = Date.now() - startTime;
        resolve({
          success: false,
          error: error.message,
          executionTime
        });
      });

      pythonProcess.on('timeout', () => {
        pythonProcess.kill();
        const executionTime = Date.now() - startTime;
        resolve({
          success: false,
          error: 'Script execution timed out',
          executionTime
        });
      });
    });
  }
}

// Default instance
export const pythonRunner = new PythonRunner();

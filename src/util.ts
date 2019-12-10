
/*
* 公共函数
*/

import * as cp from "child_process";
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as process from 'process';
import * as vscode from 'vscode';
import { createHash } from 'crypto';
import * as dns from 'dns';
import * as iconv from 'iconv-lite';

const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);


export function updateStatus(text: string) {
    statusItem.text = text;
    statusItem.show();
    console.log(`updateStatus: ${text}`);
}

export function showErrorMessage(message: string) {
    vscode.window.showErrorMessage(message);
    console.error(message);
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function now(): number {
    return new Date().getTime();
}

export function decode(buff: string | Buffer): string {
    if(!(buff instanceof Buffer)) {
        buff = new Buffer(buff, 'binary');
    }

    let result = iconv.decode(buff, 'utf8');
    if(result.indexOf(String.fromCharCode(0xfffd)) >= 0) {
        // 不是utf8编码
        result = iconv.decode(buff, 'gbk');
    }
    return result;
}

export function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
    if(!options.maxBuffer) {
        options.maxBuffer = 2 * 1024 * 2048;
    }

    if(options.env) {
        let regularEnv = process.env;
        options.env = Object.assign(regularEnv, options.env);
    }

    let optionsWithEncoding: cp.ExecFileOptionsWithBufferEncoding = <cp.ExecFileOptionsWithBufferEncoding>options;
    if(!optionsWithEncoding.hasOwnProperty('encoding')) {
        optionsWithEncoding['encoding'] = 'binary';
    }

    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        cp.exec(command, optionsWithEncoding, (error, _stdout, _stderr) => {
            let stdout = decode(_stdout);
            let stderr = decode(_stderr);
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        });
    });
}

export function formatJson(json: object): string {
    let text = JSON.stringify(json, null, 4);
    return text;
}

/*
* Get $HOME path
*/
export function getHomePath(): string | undefined {
    let home: string | undefined = process.env['HOME'];
    if(home === undefined) {
        home = process.env['%UserProfile%'];
    }
    return home;
}

/*
* 获取用户数据目录
*/
export function getUserDataDir(): string {
    const logDirPath: string | undefined = process.env['VSCODE_LOGS']; //通过这个环境变量获取用户数据目录，寻找更好的实现方法
    if(logDirPath === undefined) {
        return "";
    }
    return path.dirname(path.dirname(logDirPath));
}

export function getPythonPath(): string {
    if(os.platform() === 'win32') {
        let pyPath:string = vscode.workspace.getConfiguration('python').get('pythonPath') || '';
        return pyPath? pyPath.toString(): "python.exe";
    } else {
        return "python";
    }
}

export function getPipSource(): string | undefined {
    return vscode.workspace.getConfiguration('qta').get('pipSource');
}

export function getJsonFromFile(path: string): {[key:string]:any} {
    const text = fs.readFileSync(path).toString();
    return JSON.parse(text);
}

/*
* 计算字符串md5的16进制
*/
export function getMd5Hex(value: string): string {
    return createHash('md5').update(value.toLowerCase()).digest('hex');
}

export function resolveDomain(domain: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        dns.lookup(domain, function(err, result) {
            if(err) {
                reject(err);
            }
            resolve(result);
        });
    });
}

/*
* 是否是Python项目
*/
export function isPythonProject(folderPath: string): boolean {
    if (fs.existsSync(folderPath)) {
        let files = fs.readdirSync(folderPath);
        for(let i = 0; i < files.length; i++) {
            let subPath = path.join(folderPath, files[i]);
            let stat = fs.lstatSync(subPath);
            if (stat.isDirectory()) {
                let result = isPythonProject(subPath);
                if(result) {
                    return result;
                }
            } else if (files[i].endsWith('.py')) {
                return true;
            }
        }
    }
    return false;
}

/*
* 是否是QTA项目
*/
export function isQTAProject(folderPath: string): boolean {
    let fileList = ['manage.py', 'settings.py'];
    for(let i of fileList) {
        if(!fs.existsSync(path.join(folderPath, i))) {
            return false;
        }
    }
    return true;
}

/*
* 是否存在requirements.txt
*/
export function hasRequirements(projPath: string): boolean {
    if(fs.existsSync(projPath)){
        let files = fs.readdirSync(projPath);
        for(let i = 0; i < files.length; i++) {
            if(files[i] === 'requirements.txt') {
                return true;
            }
        }
    }
    return false;
}

export function getFileLastModifiedTime(filePath: string): number {
    const st = fs.statSync(filePath);
    return st.mtime.getTime();
}
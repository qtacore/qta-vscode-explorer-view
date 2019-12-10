/*
* 解析Python文件
*/

'use strict';

import * as path from 'path';
import * as fs from 'fs';
import { exec, getFileLastModifiedTime, sleep, updateStatus } from './util';
import { PythonEnviron } from './pythonenv';
import * as vscode from 'vscode';

export class PythonParser {
    private static instances: {[key: string]: PythonParser} = {};
    private static formatVersion: number = 1;
    private parserPath: string;
    private pythonEnv: PythonEnviron;
    private cachedData: {[key:string]:any};
    private dataChanged: {[key:string]:boolean};

    constructor(pythonEnv: PythonEnviron) {
        this.parserPath = path.join(__filename, '..', '..', 'bin', 'parse_file.py');
        this.pythonEnv = pythonEnv;
        this.cachedData = {}; // 缓存数据，用于减少文件读写操作
        this.dataChanged = {}; // 数据是否发生变化
        this.syncDataWorker(); // 开始监听数据变化
    }

    public static getInstance(env: PythonEnviron) {
        if(!(env.getRoot() in PythonParser.instances)) {
            PythonParser.instances[env.getRoot()] = new PythonParser(env);
        }
        return PythonParser.instances[env.getRoot()];
    }

    public static removeInstance(env: PythonEnviron) {
        if(env.getRoot() in PythonParser.instances) {
            delete PythonParser.instances[env.getRoot()];
        }
    }

    findProjectRoot(filePath: string): string {
        let dirPath = path.dirname(filePath);
        while(dirPath.length > 3){
            if(fs.existsSync(path.join(dirPath, '.vscode'))){
                return dirPath;
            }
            dirPath = path.dirname(dirPath);
        }
        return "";
    }

    async getDocString(modulePath: string, classOrFunc?: string): Promise<string | undefined> {
        let result = await this.parseFile(modulePath);
        if(!result) {
            return;
        }
        if(!classOrFunc){
            // get module docstring
            return result['docstring'];
        }else if(classOrFunc.indexOf(".") >= 0){
            // class.func
            let pos = classOrFunc.indexOf(".");
            let className = classOrFunc.substr(pos);
            let funcName = classOrFunc.substring(pos + 1, classOrFunc.length);
            if(result['classes']){
                for(let i = 0; i < result['classes'].length; i++){
                    if(result['classes'][i]['name'] === className){
                        let functions = result['classes'][i]['functions'];
                        if(!functions) {
                            return;
                        }
                        for(let j = 0; j < functions.length; j++){
                            if(functions[j]['name'] === funcName){
                                return functions[j]['docstring'];
                            }
                        }
                        return;
                    }
                }
            }
        } else{
            // class or function
            if(result['classes']){
                for(let i = 0; i < result['classes'].length; i++){
                    if(result['classes'][i]['name'] === classOrFunc){
                        return result['classes'][i]['docstring'];
                    }
                }
            } else if(result['functions']){
                for(let i = 0; i < result['functions'].length; i++){
                    if(result['functions'][i]['name'] === classOrFunc){
                        return result['functions'][i]['docstring'];
                    }
                }
            }

        }
    }

    async getClassList(modulePath: string): Promise<{[key:string]:any} | undefined> {
        let result =  await this.parseFile(modulePath);
        if(!result) {
            return;
        }
        return result['classes'];
    }

    async getFunctionList(modulePath: string, className?: string): Promise<{[key:string]:any} | undefined> {
        let result =  await this.parseFile(modulePath);
        if(!result) {
            return;
        }
        if(className && result['classes']) {
            for(let i = 0; i < result['classes'].length; i++){
                if(result['classes'][i]['name'] === className) {
                    return result['classes'][i]['functions'];
                }
            }
            return;
        } else if(className) {
            return;
        } else{
            return result['functions'];
        }
    }

    /*
    * 解析Python文件
    * 这里不能使用`async`，因为TreeDataProvider的getChildren接口不支持async
    */
    async parseFile(filePath: string): Promise<{[key:string]:any} | undefined> {
        if(!fs.existsSync(filePath)){
            return;
        }
        const projectRoot = this.findProjectRoot(filePath);
        if(!projectRoot) {
            return;
        }
        const ravFilePath = filePath.substring(projectRoot.length + 1, filePath.length);
        const cacheFile = path.join(projectRoot, '.vscode', 'python.cache');
        let command = `"${this.pythonEnv.getPythonPath()}" "${this.parserPath}" "${filePath}"`;
        let result = undefined;
        try{
            result = await exec(command, {'maxBuffer': 1024*1024});
        } catch(err){
            console.error(`parse ${filePath} failed\n${err.stderr}`);
            updateStatus(`文件${filePath}解析错误，请确认Python版本`);
            vscode.window.showErrorMessage(`文件${filePath}解析错误，请重新确认Python版本`);
            return;
        }

        try {
            result = JSON.parse(result.stdout);
        } catch(err) {
            console.error(`parse ${result.stdout} failed`);
            return;
        }

        if(result.errors.length > 0) {
            console.error(`parse failed: ${ JSON.stringify(result.errors) || ''}`);
            return;
        }

        if(!this.cachedData[projectRoot] && fs.existsSync(cacheFile)){
            let cacheText = fs.readFileSync(cacheFile).toString();
            try {
                const cacheObj = JSON.parse(cacheText);
                if(cacheObj['formatVersion'] === PythonParser.formatVersion) {
                    this.cachedData[projectRoot] = cacheObj; // format version must equal
                }else{
                    this.cachedData[projectRoot] = {'formatVersion': PythonParser.formatVersion};
                }
            } catch(err) {
                console.log(`Cache data error: ${cacheText}`);
            }
        } else if(!this.cachedData[projectRoot]) {
            this.cachedData[projectRoot] = {'formatVersion': PythonParser.formatVersion};
        }
        if(this.cachedData[projectRoot].hasOwnProperty(ravFilePath)){
            const mtime = getFileLastModifiedTime(filePath);
            if(mtime === this.cachedData[projectRoot][ravFilePath][0]) {
                return this.cachedData[projectRoot][ravFilePath][1];
            }
            console.log(`file ${filePath} changed ${mtime} ${this.cachedData[projectRoot][ravFilePath][0]}`);
        }
        
        this.cachedData[projectRoot][ravFilePath] = [];
        this.cachedData[projectRoot][ravFilePath].push(getFileLastModifiedTime(filePath)); //文件最后修改时间
        this.cachedData[projectRoot][ravFilePath].push(result);
        console.log(`cache add ${filePath}`);
        this.dataChanged[projectRoot] = true;
        return result;
    }

    private async syncDataWorker() {
        while(true) {
            await sleep(10*1000);
            for(let key in this.cachedData) {
                if(this.cachedData[key]) {
                    const text = JSON.stringify(this.cachedData[key]);
                    const cacheFile = path.join(key, '.vscode', 'python.cache');
                    fs.writeFileSync(cacheFile, text);
                    console.log(`sync project ${key} data`);
                    this.cachedData[key] = false;
                }
            }
        }
    }
}

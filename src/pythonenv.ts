import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec, updateStatus, showErrorMessage, getPythonPath, isPythonProject, hasRequirements, formatJson, sleep, getPipSource } from './util';
import { Terminal } from './terminal';
import { URL } from 'url';

let watch = require('node-watch');

export class PythonEnviron {
    private static instances: {[key:string]:PythonEnviron} = {};
    static readonly VARIABLE_REGEXP = /\$\{(.*?)\}/g;
    public static notCheckEnv = false;

    public static envName: string = ".env";
    static virtualenvVersion: string = "16.0.0";

    private virtualenvCommand: string = "python -m virtualenv";

    private root: string;
    private envPath: string;
    private activeThisPath: string;
    private requirementsWatcher: any;
    private settingsWatcher: any;
    private requirementParserPath: string;

    private initialized: boolean;
    private checkVirtualenv: boolean;
    public envTerminal: Terminal;

    public resolveVariable(path: string) {
        const replaced = path.replace(PythonEnviron.VARIABLE_REGEXP, (match: string, variable: string) => {
            let resolvedValue = this.replaceVariable(match, variable);
            return resolvedValue;
        });
        return replaced;
    }

    public replaceVariable(match: string, variable: string) {
        switch (variable) {
            case 'workspaceRoot':
            case 'workspaceFolder':
                return this.root;
            case 'workspaceRootFolderName':
            case 'workspaceFolderBasename':
                return path.basename(this.root);
            default:
                return this.root;
        }
    }

    public static getInstance(root: string) {
        if(!(root in PythonEnviron.instances)) {
            PythonEnviron.instances[root] = new PythonEnviron(root);
        }
        return PythonEnviron.instances[root];
    }

    public static removeInstance(root: string) {
        if(root in PythonEnviron.instances) {
            delete PythonEnviron.instances[root];
        }
    }

    constructor(root: string) {
        this.root = root;
        this.envPath = path.join(this.root, PythonEnviron.envName);
        this.requirementsWatcher = undefined;
        this.settingsWatcher = undefined;
        this.requirementParserPath = path.join(__filename, '..', '..', 'bin', 'parse_requirements.py');

        this.checkVirtualenv = false;
        this.initialized = false;
        this.activeThisPath = '';
        this.envTerminal = new Terminal(this.root, undefined, undefined, this.root);
        this.envTerminal.sendText(os.platform() === 'win32' ? `set PYTHONPATH=${this.root}` : `export PYTHONPATH=${this.root}`);
        
        // this.initWatchWorker();
        this.init();
        this.initWatcherWorker();
    }

    public getRoot(): string {
        return this.root;
    }

    public getPythonPath(): string {
        const settingsPath = path.join(this.root, '.vscode', 'settings.json');
        if(!fs.existsSync(settingsPath)) {
            return getPythonPath();
        }
        let settings = JSON.parse(fs.readFileSync(settingsPath).toString());
        let pypath = settings['python.pythonPath'] ? path.resolve(this.root, this.resolveVariable(settings['python.pythonPath'])) : getPythonPath();
        return pypath;
    }

    public getPipSource(): string | undefined {
        const settingsPath = path.join(this.root, '.vscode', 'settings.json');
        if(!fs.existsSync(settingsPath)) {
            return undefined;
        }
        let settings = JSON.parse(fs.readFileSync(settingsPath).toString());
        let pipSource = settings['qta.pipSource'] ? settings['qta.pipSource'] : getPipSource();
        return pipSource;
    }

    public findVirtualEnv() {
        let envDirs = [];
        if (fs.existsSync(this.root)) {
            let files = fs.readdirSync(this.root);
            for(let i = 0; i < files.length; i++) {
                let subPath = path.join(this.root, files[i]);
                let stat = fs.lstatSync(subPath);
                if (stat.isDirectory()) {
                    let activatePath = path.join(this.root, files[i], os.platform() === 'win32' ? 'Scripts' : 'bin', 'activate_this.py');
                    if(fs.existsSync(activatePath)) {
                        envDirs.push(files[i]);
                    }
                }
            }
        }
        return envDirs;
    }

    public async init() {
        if(!isPythonProject(this.root) || !hasRequirements(this.root)) {
            return;
        }
        this.registerFileListener();

        await this.ensureEnv();
    }

    public async ensureEnv() {
        if(PythonEnviron.notCheckEnv) {
            return;
        }
        if(!this.isInEnv()) {
            this.initialized = await this.switchEnv();
            if(!this.initialized) {
                return;
            }
        }
        if(await this.checkRequirements() === false) {
            let installRequirements = await vscode.window.showInformationMessage(`检测到当前环境依赖项与requirements.txt不匹配，是否安装依赖项？`, '是', '否', "不再显示");
            if(installRequirements === '是') {
                this.installRequirements();
            } else if (installRequirements === "不再显示") {
                PythonEnviron.notCheckEnv = true;
                return;
            }
        }
    }

    // 判断是否已进入虚拟环境
    public isInEnv() {
        let pyPath = this.getPythonPath();
        if(fs.existsSync(path.join(path.dirname(pyPath), 'activate_this.py'))) {
            return true;
        }
        return false;
    }

    // 进入虚拟环境, 没有虚拟环境引导进行虚拟环境的创建
    public async switchEnv() {
        let envDirs = this.findVirtualEnv();
        if(envDirs.length > 1) {
            let message = await vscode.window.showInformationMessage(`检测到项目${path.basename(this.root)}中存在虚拟环境，是否切换到虚拟环境？`,  ...[ "是", "否", "不再显示" ]);
            if(message === '是') {
                let envdir = await vscode.window.showQuickPick(envDirs, { placeHolder: '检测到项目中存在多个虚拟环境，请选择终端中需要使用的虚拟环境，按Esc取消。' }) || '';
                if(!!envdir) {
                    this.envPath = path.join(this.root, envdir);
                    this.activeThisPath = path.join(this.envPath, os.platform() === 'win32' ? 'Scripts' : 'bin', 'activate_this.py');
                    this.updatePythonPath();
                    return true;
                }
            } else if (message === "不再显示") {
                PythonEnviron.notCheckEnv = true;
            }
        } else if(envDirs.length === 1) {
            let message = await vscode.window.showInformationMessage(`检测到项目${path.basename(this.root)}中存在虚拟环境，是否切换到虚拟环境？`,  ...[ "是", "否", "不再显示" ]);
            if (message === '是') {
                this.envPath = path.join(this.root, envDirs[0]);
                this.activeThisPath = path.join(this.envPath, os.platform() === 'win32' ? 'Scripts' : 'bin', 'activate_this.py');
                this.updatePythonPath();
                return true;
            } else if (message === "不再显示") {
                PythonEnviron.notCheckEnv = true;
            }
        } else {
            let createVenv = await vscode.window.showInformationMessage(`检测到项目${path.basename(this.root)}中不存在虚拟环境，是否创建并切换到虚拟环境？`,  ...[ "是", "否", "不再显示" ]);
            if(createVenv === '是') {
                await this.initVirtualEnv();
                // this.installRequirements();
                return true;
            } else if(createVenv === "不再显示") {
                PythonEnviron.notCheckEnv = true;
            }
        }
        return false;
    }

    public async activateEnv() {
        let activateCommand = path.join(this.envPath, 'Scripts', 'activate.bat');
        if(os.platform() === 'win32') {
            activateCommand = `"${path.join(this.envPath, 'Scripts', 'activate.bat')}"`;
        } else {
            activateCommand = `source ${path.join(this.envPath, 'bin', 'activate')};`;
        }
        this.envTerminal.sendText(`${activateCommand}`);
    }

    public deactivateEnv() {
        if(fs.existsSync(path.join(this.envPath, os.platform() === 'win32' ? 'Scripts' : 'bin', 'activate_this.py'))) {
            this.envTerminal.sendText(`deactivate`);
            this.envPath = '';
            this.activeThisPath = '';
        }
    }

    public setSysPath() {
        if(os.platform() === 'win32') {
            this.envTerminal.sendText(`SET PATH=${path.dirname(this.getPythonPath())};${path.join(path.dirname(this.getPythonPath()), 'Scripts')};%PATH%`);
        } else {
            this.envTerminal.sendText(`export PATH=${path.dirname(this.getPythonPath())}:%PATH%`);
        }
        
    }

    public updatePythonPath(): void {
        const vscodeDir = path.join(this.root, '.vscode');
        if(!fs.existsSync(vscodeDir)){
            fs.mkdirSync(vscodeDir);
        }
        const settingsPath = path.join(vscodeDir, 'settings.json');
        let settings:{[key:string]:any} = {};
        if(fs.existsSync(settingsPath)){
            settings = JSON.parse(fs.readFileSync(settingsPath).toString());
        }
        if(os.platform() === 'win32') {
            settings['python.pythonPath'] = path.join(this.envPath, 'Scripts', 'python.exe');
        } else {
            settings['python.pythonPath'] = path.join(this.envPath, 'bin', 'python');
        }
        
        let text = formatJson(settings);
        fs.writeFileSync(settingsPath, text);
    }

    async checkVirtualEnv(): Promise<boolean> {
        let shellPath = this.getPythonPath();
        this.virtualenvCommand = `"${shellPath}" -m virtualenv`;
        let command = `${this.virtualenvCommand} --version`;
        let stdout = '';

        try{
            let result = await exec(command, {});
            stdout = result.stdout;
        } catch (err) {
            updateStatus(`virtualenv not installed: ${err.stderr}`);
            if(!this.checkVirtualenv) {
                showErrorMessage(`当前所选Python环境未安装virtualenv，请确认选择的Python环境或自行安装virtualenv后再自行安装虚拟环境!(Tips: Virtualenv安装命令为 python -m pip install virtualenv)`);
                this.checkVirtualenv = true;
                return false;
            }
        }
        this.checkVirtualenv = true;
        if (parseInt(stdout.split('.')[0]) > 13) {
            updateStatus(`Check virtualenv status ok`);
            return true;
        } else {
            showErrorMessage(`当前virtualenv版本过低，请对virtualenv进行版本更新后再自行安装虚拟环境!(Tips: Virtualenv安装命令为 python -m pip install virtualenv)`);
        }

        return false;
    }

    /*
    * 注册文件监听器，在文件变化时自动安装依赖
    */
    public registerFileListener() {
        let self = this;

        let requirementsPath = path.join(this.root, 'requirements.txt');
        if(fs.existsSync(requirementsPath) && this.requirementsWatcher === undefined) {
            this.requirementsWatcher = watch(requirementsPath,  {recursive: false});
            this.requirementsWatcher.on('change', async function (event: string, filename: string) {
                let result = await vscode.window.showInformationMessage('检测到requirements.txt发生变化，是否重新安装依赖项？', ...['是', '否']);
                if(result === '是') {
                    await self.installRequirements();
                }
            });
            this.requirementsWatcher.on('error', function (error: any) {
                if(error.message.indexOf("EPERM") !== -1 && self.requirementsWatcher) {
                    self.requirementsWatcher.close();
                    self.requirementsWatcher = undefined;
                }
            });
        }

        let settingsPath = path.join(this.root, '.vscode', 'settings.json');
        if(fs.existsSync(settingsPath) && this.settingsWatcher === undefined) {
            this.settingsWatcher = watch(settingsPath,  {recursive: false});
            this.settingsWatcher.on('change', function (event: string, filename: string) {
                if(os.platform() === 'win32') {
                    if((self.getPythonPath().includes('Scripts'))) {
                        self.envPath = path.resolve(self.getPythonPath(), '../..');
                        self.activateEnv();
                    } else {
                        self.deactivateEnv();
                        self.setSysPath();
                    }
                } else {
                    let envPath = path.resolve(self.getPythonPath(), '..');
                    if(fs.existsSync(path.join(envPath, 'activate_this.py'))) {
                        self.envPath = path.resolve(self.getPythonPath(), '../..');
                        self.activateEnv();
                    } else {
                        self.deactivateEnv();
                        self.setSysPath();
                    }
                }      
            });
            this.requirementsWatcher.on('error', function (error: any) {
                if(error.message.indexOf("EPERM") !== -1 && self.settingsWatcher) {
                    self.settingsWatcher.close();
                    self.settingsWatcher = undefined;
                }
            });
        }
    }

    closeFileListener() {
        if(this.requirementsWatcher) {
            this.requirementsWatcher.close();
            this.requirementsWatcher = null;
        }
        if(this.settingsWatcher) {
            this.settingsWatcher.close();
            this.settingsWatcher = null;
        }
    }

    /*
    *  创建Python虚拟环境
    */
    public async initVirtualEnv() {
        if(this.initialized) {
            return false;
        }
        let envFolder = await vscode.window.showInputBox({ prompt: '虚拟环境文件夹路径：', value: '.env', validateInput: (value) => {
            if(fs.existsSync(path.join(this.root, value))) {
                return `已存在名为${value}的文件/文件夹`;
            }
            return undefined;
        } });
        if(!envFolder) {
            return false;
        }
        this.initialized = true;
        await vscode.commands.executeCommand('python.setInterpreter');
        if(!(await this.checkVirtualEnv())) {
            return false;
        }
        this.virtualenvCommand = `"${this.getPythonPath()}" -m virtualenv`;
        this.envPath = path.join(this.root, envFolder);
        if(!fs.existsSync(this.envPath) || !fs.existsSync(this.activeThisPath)) {
            let command = `${this.virtualenvCommand} "${this.envPath}" --python=${this.getPythonPath()}`;

            try {
                this.envTerminal.sendText(command);
                this.updatePythonPath();
                this.activateEnv(); // 未安装完成时updatePythonPath不会触发activate
            } catch(err){
                showErrorMessage(`Create env dir failed: ${err.stderr}`);
                return false;
            }
        }
        return true;
    }

    /*
    *  检查依赖库是否安装正确
    */
    async checkRequirements() {
        try {
            let requirementsPath = path.join(this.root, 'requirements.txt');
            if(!fs.existsSync(requirementsPath)) {
                return undefined;
            }
            let result = await exec(`"${this.getPythonPath()}" "${this.requirementParserPath}" "${requirementsPath}"`, {});
            if(result.stdout) {
                let check_result = JSON.parse(result.stdout);
                return check_result['result'];
            } else {
                throw result.stderr;
            }
        } catch (error) {
            return false;
        }
    }

    /*
    *  安装依赖库到Python虚拟环境
    */
    async installRequirements() {
        let requirements = path.join(this.root, 'requirements.txt');
        if(!fs.existsSync(requirements)) {
            return;
        }
        let pipSource = this.getPipSource();
        this.envTerminal.sendText(`${this.getPythonPath()} -m pip install -r ${requirements}${pipSource ? ` -i ${pipSource} --trusted-host ${new URL(pipSource).host}` : ''}`);
    }

    private async initWatcherWorker() {
        let settingsPath = path.join(this.root, '.vscode', 'settings.json');
        let self = this;
        while(!this.settingsWatcher) {
            await sleep(500);
            if(fs.existsSync(settingsPath) && this.settingsWatcher === undefined) {
                this.settingsWatcher = watch(settingsPath,  {recursive: false});
                this.settingsWatcher.on('change', function (event: string, filename: string) {
                    let envPath = path.resolve(self.getPythonPath(), '..');
                    if(fs.existsSync(path.join(envPath, 'activate_this.py'))) {
                        self.envPath = path.resolve(self.getPythonPath(), '../..');
                        self.activateEnv();
                    } else {
                        self.deactivateEnv();
                        self.setSysPath();
                    }
                });
                this.settingsWatcher.on('error', function (error: any) {
                    if(error.message.indexOf("EPERM") !== -1 && self.settingsWatcher) {
                        self.settingsWatcher.close();
                        self.settingsWatcher = undefined;
                    }
                });
            }
        }
    }
}
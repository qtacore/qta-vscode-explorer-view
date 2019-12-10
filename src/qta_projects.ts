import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { formatJson, sleep, isQTAProject } from './util';
import { PythonEnviron } from './pythonenv';
import { PythonParser } from './python_parser';

class QTAProject {
    private pythonEnv: PythonEnviron;
    private pythonParser: PythonParser;
    private inited: Boolean = false;

    constructor(
        public readonly path: string,
	) {
        this.pythonEnv = PythonEnviron.getInstance(this.path);
        this.pythonParser = PythonParser.getInstance(this.pythonEnv);
    }

    public async init() {
        if(this.inited) {
            return;
        }
        // 创建.vscode目录和配置文件
        // await this.updateSettings();
        this.inited = true;
    }

    public envTerminal() {
        return this.pythonEnv.envTerminal;
    }

    public async initPythonEnviron() {
        return await this.pythonEnv.initVirtualEnv();
    }

    public async installRequirements() {
        await this.pythonEnv.installRequirements();
    }

    public async ensureEnv() {
        await this.pythonEnv.ensureEnv();
    }

    public getPythonPath() {
        return this.pythonEnv.getPythonPath();
    }

    /*
    * 更新settings.json
    */
    public async updateSettings(force?: boolean) {
        if(force === undefined) {
            force = false;
        }
        if(!fs.existsSync(this.path)) {
            fs.mkdirSync(this.path);
        }
        const vscodeDir = path.join(this.path, '.vscode');
        if(!fs.existsSync(vscodeDir)){
            fs.mkdirSync(vscodeDir);
        }
        const settingsPath = path.join(vscodeDir, 'settings.json');
        if(fs.existsSync(settingsPath) && !force){
            return; // 存在即返回
        }

        const settings:{[key:string]:any} = {};
        settings['python.autoComplete.extraPaths'] = ["${workspaceFolder}"];
        settings['python.autoComplete.preloadModules'] = [];
        settings['files.exclude'] = {
                                    "**/.git": true,
                                    "**/.svn": true,
                                    "**/.hg": true,
                                    "**/CVS": true,
                                    "**/.DS_Store": true,
                                    ".settings": true,
                                    "**/*.pyc": true
                                };
        settings['files.exclude'][`**/${PythonEnviron.envName}`] = true;
        settings['python.linting.enabled'] = true;
        let text = formatJson(settings);
        fs.writeFileSync(settingsPath, text);
    }

    unWatchPythonEnv() {
        this.pythonEnv.closeFileListener();
    }

    dispose() {
        PythonParser.removeInstance(this.pythonEnv);
        this.unWatchPythonEnv();
        this.pythonEnv.envTerminal.close();
        PythonEnviron.removeInstance(this.path);
    }

    public getDocString(modulePath: string, classOrFunc?: string): Promise<string | undefined> {
        return this.pythonParser.getDocString(modulePath, classOrFunc);
    }

    public getClassList(modulePath: string): Promise<{[key:string]:any} | undefined> {
        return this.pythonParser.getClassList(modulePath);
    }

    public getFunctionList(modulePath: string, className?: string): Promise<{[key:string]:any} | undefined> {
        return this.pythonParser.getFunctionList(modulePath, className);
    }
}

export class QTAProjectManager {
    static QTAProjects: QTAProject[] = [];

    public static get(path: string): QTAProject {
        let project = QTAProjectManager.QTAProjects.find(project => project.path === path) || new QTAProject(path);
        QTAProjectManager.QTAProjects.push(project);
        return project;
    }

    public static find(path: string): QTAProject | undefined {
        let project = QTAProjectManager.QTAProjects.find(project => path.includes(project.path));
        return project;
    }

    public add(projPath: string) {
        if(path.basename(projPath).startsWith('.')) {
            return;
        }
        if(!fs.lstatSync(projPath).isDirectory()) {
            return;
        }
        if(!isQTAProject(projPath)) {
            return;
        }
        let nProject = QTAProjectManager.get(projPath);
        nProject.init();
    }

    public remove(projPath: string) {
        let index = QTAProjectManager.QTAProjects.findIndex(project => project.path === projPath);
        if(index !== -1) {
            QTAProjectManager.QTAProjects[index].dispose();
            QTAProjectManager.QTAProjects.splice(index, 1);
        }
    }
}

class TreeItem extends vscode.TreeItem {
    protected docstring: string;
    public dataCompleted: boolean;
    public children: TreeItem[] = [];
    // public parent: TreeItem | undefined = undefined;

    constructor(
        public readonly root: string,
        public readonly label: string,
        docstring: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly qtaProject: QTAProject | undefined,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(label, collapsibleState);
        this.qtaProject = qtaProject;
        this.docstring = docstring;
        this.command = command;
        this.contextValue = contextValue;
        this.tooltip = docstring ? docstring : label;
        this.description = this.tooltip;
        this.dataCompleted = false;
        this.setTooltip();
    }

    toString(): string {
        return `[TreeItem object ${this.label}]`;
    }


    getPath(): string {
        return path.join(this.root, this.label);
    }

    public isFolder(): boolean {
        return this.contextValue === "folder";
    }

    public async getDocString(): Promise<string | undefined> {
        //console.log(`${this.label} getDocString ${this.docstring}`);
        return this.docstring;
    }

    async setTooltip(): Promise<any> {
        let docstring = await this.getDocString();
        if(docstring) {
            this.tooltip = docstring;
            this.description = docstring;
        }
        this.dataCompleted = true;
        vscode.commands.executeCommand("qta.extension.view.refresh", this);
    }

    setIcon(iconPath: string): void {
        //console.log("setIcon: " + iconPath + " " + path.join(__filename, '..', '..', 'resources', 'light', iconPath));
        this.iconPath = {
            light: path.join(__filename, '..', '..', 'resources', 'light', iconPath),
            dark: path.join(__filename, '..', '..', 'resources', 'dark', iconPath)
        };
    }
}

export class ClassTreeItem extends TreeItem {
    private staticFields: Array<{[key:string]:any}>;
    private functions: Array<{[key:string]:any}>;
    private controls: Array<{[key:string]:any}>;

    constructor(
        public readonly root: string,
        public readonly label: string,
        docstring: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly qtaProject: QTAProject,
        public readonly lineRange: [number, number],
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(root, label, docstring, collapsibleState, qtaProject, command, contextValue);
        this.setIcon('class.svg');
        this.staticFields = [];
        this.functions = [];
        this.controls = [];
    }

    getPath(): string {
        return this.root;
    }

    addStaticField(field: {[key:string]:any}): void {
        this.staticFields.push(field);
    }

    addFunction(func: {[key:string]:any}): void {
        this.functions.push(func);
    }

    addControl(control: {[key:string]:any}): void {
        this.controls.push(control);
    }

    getStaticFields(): Array<{[key:string]:any}> {
        return this.staticFields;
    }

    getFunctions(): Array<{[key:string]:any}> {
        return this.functions;
    }

    getControls(): Array<{[key:string]:any}> {
        return this.controls;
    }
}

class StaticFieldTreeItem extends TreeItem {

    constructor(
        public readonly root: string,
        public readonly label: string,
        value: string,
        public readonly qtaProject: QTAProject,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(root, label, value, vscode.TreeItemCollapsibleState.None, qtaProject, command, contextValue);
        this.setIcon('static_field.svg');
    }

    getPath(): string {
        return this.root;
    }
}

class ControlTreeItem extends TreeItem {

    constructor(
        public readonly root: string,
        public readonly label: string,
        docstring: string,
        public readonly qtaProject: QTAProject,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(root, label, docstring, vscode.TreeItemCollapsibleState.None, qtaProject, command, contextValue);
        this.setIcon('control.svg');
    }

    getPath(): string {
        return this.root;
    }
}

class FunctionTreeItem extends TreeItem {
    private steps: Array<{[key:string]:any}>;

    constructor(
        public readonly root: string,
        public readonly label: string,
        docstring: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly qtaProject: QTAProject,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(root, label, docstring, collapsibleState, qtaProject, command, contextValue);
        this.setIcon('function.svg');
        this.steps = [];
    }

    getPath(): string {
        return this.root;
    }

    addStep(step: {[key:string]:any}): void {
        this.steps.push(step);
    }

    getSteps(): Array<{[key:string]:any}> {
        return this.steps;
    }
}

class StepTreeItem extends TreeItem {

    constructor(
        public readonly root: string,
        public readonly label: string,
        docstring: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly qtaProject: QTAProject,
        public readonly command?: vscode.Command,
        public readonly contextValue?: string,
    ){
        super(root, label, docstring, collapsibleState, qtaProject, command, contextValue);
        this.setIcon('step.svg');
    }

    getPath(): string {
        return this.root;
    }
}

export class QTATreeViewDataProvider implements vscode.TreeDataProvider<Object> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;
    public root: TreeItem[] = [];
    public refreshing: boolean = false;

    constructor() {
        this.refresh();
    }
    
    getCurrentEditor(): vscode.TextEditor | undefined {
        return vscode.window.activeTextEditor;
    }

    getCurrentVisibleEditor(): vscode.TextEditor[] {
        return vscode.window.visibleTextEditors;
    }

    refresh(node?: TreeItem): void {
        //console.log('refresh');
        if (node){
            this._onDidChangeTreeData.fire(node);
        } else{
            this._onDidChangeTreeData.fire();
        }
    }

    run(file: vscode.Uri | undefined): void {
        let path = "";
        if(typeof(file) === "object"){
            path = file instanceof TreeItem? file.getPath() : file.fsPath;
        }
        else {
            let currentEditor = this.getCurrentEditor();
            if(currentEditor === undefined){
                vscode.window.showInformationMessage('No script selected');
                return;
            }
            path = currentEditor.document.uri.fsPath;
        }
        this.runScript(path);
    }

    async runScript(filePath: string): Promise<void> {
        let editors = vscode.window.visibleTextEditors;
        for(let i of editors) {
            if(vscode.Uri.file(filePath).toString() === i.document.uri.toString()) {
                if(i.document.isDirty) {
                    i.document.save();
                }
            }
        }

        let qtaProject = QTAProjectManager.find(filePath);
        if(qtaProject) {
            await qtaProject.ensureEnv();
            qtaProject.envTerminal().show();
            qtaProject.envTerminal().sendText(`${qtaProject.getPythonPath()} ${filePath}`);
        }
    }

    async runTestcase(testcaseItem: ClassTreeItem) {
        await testcaseItem.qtaProject.ensureEnv();
        let relativePath = path.relative(testcaseItem.qtaProject.path, testcaseItem.root);
        testcaseItem.qtaProject.envTerminal().show();
        testcaseItem.qtaProject.envTerminal().sendText(`${testcaseItem.qtaProject.getPythonPath()} manage.py runtest ${relativePath.replace('.py', '').split(path.sep).join('.')}.${testcaseItem.label}`);
    }

    async runTestcaseInline() {
        let currentEditor = this.getCurrentEditor();
        if(currentEditor === undefined){
            vscode.window.showInformationMessage('No script selected');
            return;
        }
        let currentAnchorLine = currentEditor.selection.anchor.line;
        for(let i of this.root) {
            if(i instanceof ClassTreeItem) {
                if(currentAnchorLine >= i.lineRange[0] && currentAnchorLine <= i.lineRange[1]) {
                    if(i.contextValue === 'testcase') {
                        this.runTestcase(i);
                    } else {
                        vscode.window.showInformationMessage('当前行所在类不是一个有效的测试用例');
                    }
                    
                }
            }
            
        }
    }

    async openFile(filePath: string, line?: number): Promise<void> {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), {'preview': false});
        if(line) {
            const editor = vscode.window.activeTextEditor;
            if(!editor) {
                console.log('editor is null');
                return;
            }
            
            const position = editor.selection.active;
            var newPosition = position.with(line - 1, 0);
            var newSelection = new vscode.Selection(newPosition, newPosition);
            editor.selection = newSelection;
            let offset = newPosition.line - (editor.visibleRanges[0].end.line + editor.visibleRanges[0].start.line) / 2;
            if(Math.abs(offset) > 1) {
                console.log(`scroll ${offset}`);
                vscode.commands.executeCommand('editorScroll', {to: offset > 0 ? 'down' : 'up', by: 'line', value: Math.abs(offset), revealCursor: false});
            }
        }
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    /*
    * 该函数不能使用async和await
    */
    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        if (element === undefined) {
            this.refreshing = true;
            let self = this;
            let root: TreeItem[] = [];
            let activeTextEditor = this.getCurrentEditor();
            if(!activeTextEditor) {
                return root;
            }

            let rootPath = activeTextEditor.document.uri.fsPath;
            let qtaProject = QTAProjectManager.find(rootPath);
            if(!qtaProject) {
                return root;
            }

            let classItems: TreeItem[] = [];
            let funcItems: TreeItem[] = [];
            let classCompleteFlag = false;
            let result = qtaProject.getClassList(rootPath);
            result.then(value => {
                if(!qtaProject) {
                    return;
                }
                if(value){
                    let classList = <Array<any>>value;
                    for(let i = 0; i < classList.length; i++){
                        const className = classList[i]['name'];
                        const docstring = classList[i]['docstring'];
                        const item = new ClassTreeItem(rootPath, className, docstring, vscode.TreeItemCollapsibleState.Collapsed, qtaProject, [classList[i]['line'], classList[i]['endline']], {
                            command: 'qta.extension.view.openFile',
                            title: `Open ${className}`,
                            arguments: [rootPath, classList[i]['line']]
                        }, classList[i]['is_testcase'] ? 'testcase' : undefined);
                        for(let j = 0; j < classList[i]['static_fields'].length; j++) {
                            item.addStaticField(classList[i]['static_fields'][j]);
                        }
                        for(let j = 0; j < classList[i]['functions'].length; j++) {
                            item.addFunction(classList[i]['functions'][j]);
                        }
                        if(classList[i]['controls']) {
                            for(let j = 0; j < classList[i]['controls'].length; j++) {
                                item.addControl(classList[i]['controls'][j]);
                            }
                        }
                        classItems.push(item);
                    }
                }
                classCompleteFlag = true;
            });
            let funcCompleteFlag = false;
            result = qtaProject.getFunctionList(rootPath);
            result.then(value => {
                if(!qtaProject) {
                    return;
                }
                if(value){
                    let funcList = <Array<any>>value;
                    for(let i = 0; i < funcList.length; i++){
                        const funcName = funcList[i]['name'];
                        const docstring = funcList[i]['docstring'];
                        const item = new FunctionTreeItem(rootPath, funcName, docstring, vscode.TreeItemCollapsibleState.None, qtaProject, {
                            command: 'qta.extension.view.openFile',
                            title: `Open ${funcName}`,
                            arguments: [rootPath, funcList[i]['line']]
                        }, undefined);
                        funcItems.push(item);
                    }
                }
                funcCompleteFlag = true;
            });

            function retry(resolve: Function) {
                sleep(10).then(() => {
                    if (!classCompleteFlag || !funcCompleteFlag) {
                        retry(resolve);
                    } else {
                        self.root = classItems.concat(funcItems);
                        self.refreshing = false;
                        resolve(self.root);
                    }
                });
            }
            return new Promise((resolve) => retry(resolve));
        } else if (element instanceof ClassTreeItem) {
            const rootPath = element.getPath();
            const items = [];
            const controls = element.getControls();
            for (let i = 0; i < controls.length; i++) {
                const item = new ControlTreeItem(rootPath, controls[i]['name'], controls[i]['attrs']['type'][1], element.qtaProject, {
                    command: 'qta.extension.view.openFile',
                    title: `Open ${element.label}:${controls[i]['name']}`,
                    arguments: [rootPath, controls[i]['line']]
                }, undefined);
                items.push(item);
            }

            const staticFields = element.getStaticFields();
            for(let i = 0; i < staticFields.length; i++) {
                const item = new StaticFieldTreeItem(rootPath, staticFields[i][0], staticFields[i][1], element.qtaProject, {
                    command: 'qta.extension.view.openFile',
                    title: `Open ${element.label}:${staticFields[i][0]}`,
                    arguments: [rootPath, staticFields[i][2]]
                }, undefined);
                items.push(item);
            }

            const functions = element.getFunctions();
            for(let i = 0; i < functions.length; i++) {
                let state = functions[i]['steps'] && functions[i]['steps'].length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
                const item = new FunctionTreeItem(rootPath, functions[i]['name'], functions[i]['docstring'], state, element.qtaProject, {
                    command: 'qta.extension.view.openFile',
                    title: `Open ${element.label}:${functions[i]['name']}`,
                    arguments: [rootPath, functions[i]['line']]
                }, undefined);
                items.push(item);
                for(let j = 0; j < functions[i]['steps'].length; j++) {
                    item.addStep(functions[i]['steps'][j]);
                }
            }
            return items;
        } else if (element instanceof FunctionTreeItem) {
            const rootPath = element.getPath();
            const items = [];
            const steps = element.getSteps();
            for(let i = 0; i < steps.length; i++) {
                const item = new StepTreeItem(rootPath, steps[i]['name'], steps[i]['docstring'], vscode.TreeItemCollapsibleState.None, element.qtaProject, {
                    command: 'qta.extension.view.openFile',
                    title: `Open ${element.label}:${steps[i]['name']}`,
                    arguments: [rootPath, steps[i]['line']]
                }, undefined);
                items.push(item);
            }
            return items;
        }
        return Promise.resolve([]);
    }
}
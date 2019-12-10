//  Terminal: Create New Integrated Terminal 

import * as vscode from 'vscode';

export class Terminal {
    protected _terminal: vscode.Terminal;
    protected _name?: string;
    // protected _createTime: Date;
    protected _shellPath?: string;
    protected _shellArgs?: string[];
    protected _cwd?: string;
    protected _env?: { [key: string]: string | null };

    constructor(name?: string, shellPath?: string, shellArgs?: string[], cwd?: string, env?: { [key: string]: string | null }) {
        this._name = name;
        //this._createTime = new Date();
        this._shellPath = shellPath;
        this._shellArgs = shellArgs;
        this._cwd = cwd;
        this._env = env;
        const terminals = vscode.window.terminals;
        this._terminal = terminals.find(terminal => terminal.name === `QTA - ${name}`) || vscode.window.createTerminal({
            'cwd': cwd,
            'name': `QTA - ${name}`,
            'shellPath': shellPath,
            'shellArgs': shellArgs,
            'env': env
        });
        this._terminal.show(true);
    }

    public get name(): string | undefined {
        return this._name;
    }

    public close() {
        this._terminal.dispose();
    }

    public show(perserved?: boolean) {
        this._terminal.show(perserved);
    }

    public sendText(text: string, addNewLine?: boolean) {
        this._terminal.sendText(text, addNewLine);
    }
}

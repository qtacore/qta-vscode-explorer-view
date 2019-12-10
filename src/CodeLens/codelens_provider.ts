import * as vscode from 'vscode';
import { QTAProjectManager, QTATreeViewDataProvider, ClassTreeItem } from '../qta_projects';
import { sleep } from '../util';

class QTACodeLen extends vscode.CodeLens {
    private testcase: ClassTreeItem;

    constructor(range: vscode.Range, testcase: ClassTreeItem) {
        super(range);
        this.testcase = testcase;
    }

    public getTestcase() {
        return this.testcase;
    }
}

/**
 * CodelensProvider
 */
export class CodelensProvider implements vscode.CodeLensProvider {

    private codeLensMap:{[key:string]:vscode.CodeLens[]} = {};
    // private codeLenses: vscode.CodeLens[] = [];
    private qtaDataProvider: QTATreeViewDataProvider;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor(qtaDataProvider: QTATreeViewDataProvider) {

        vscode.workspace.onDidChangeConfiguration((_) => {
            this.refresh();
        });
        this.qtaDataProvider = qtaDataProvider;
    }

    async refresh(): Promise<void> {
        while(this.qtaDataProvider.refreshing) {
            await sleep(100);
        }
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        
        if (vscode.workspace.getConfiguration("qta").get("enableCodeLens", true)) {
            return this.provideCodelens(document);
        }
        return [];
    }

    private async provideCodelens(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        await sleep(500);  // 等待getChildren开始
        while(this.qtaDataProvider.refreshing) {
            await sleep(100);
        }
        let lenses: vscode.CodeLens[] = [];
        let items = this.codeLensMap[document.uri.fsPath] || [];
        let qtaProject = QTAProjectManager.find(document.uri.fsPath);
        if(qtaProject) {
            for(let i of this.qtaDataProvider.root) {
                if(i instanceof ClassTreeItem && i.contextValue === 'testcase') {
                    let line = document.lineAt(i.lineRange[0] - 1);
                    if(items.find(l => l.range.start.line === line.lineNumber)) {
                        lenses.push(items.find(l => l.range.start.line === line.lineNumber)!);
                    } else {
                        let position = new vscode.Position(line.lineNumber, 0);
                        let range = document.getWordRangeAtPosition(position);
                        if (range) {
                            lenses.push(new QTACodeLen(range, i));
                        }
                    }
                }
            }
        }
        this.codeLensMap[document.uri.fsPath] = lenses;
        return Promise.resolve(this.codeLensMap[document.uri.fsPath]);
    }

    public resolveCodeLens(codeLens: QTACodeLen, token: vscode.CancellationToken) {
        if (vscode.workspace.getConfiguration("qta").get("enableCodeLens", true)) {
            codeLens.command = {
                title: "运行QTA测试用例",
                tooltip: "运行QTA测试用例",
                command: "qta.extension.view.runTestcase",
                arguments: [codeLens.getTestcase()]
            };
            return codeLens;
        }
        return null;
    }
}

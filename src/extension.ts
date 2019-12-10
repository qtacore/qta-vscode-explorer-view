'use strict';

import * as vscode from 'vscode';
import { QTAProjectManager, QTATreeViewDataProvider } from './qta_projects';
import { updateStatus } from './util';
import { CodelensProvider } from './CodeLens/codelens_provider';
import { languages } from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "qta-projects-view" is now active!');

    let qtaProjectManager = new QTAProjectManager();

    const workspaces = vscode.workspace.workspaceFolders;
    if(workspaces) {
        for(let i of workspaces) {
            qtaProjectManager.add(i.uri.fsPath);
        }
    }

    vscode.workspace.onDidChangeWorkspaceFolders(e => {
        for(let i of e.added) {
            qtaProjectManager.add(i.uri.fsPath);
        }
        for(let i of e.removed) {
            qtaProjectManager.remove(i.uri.fsPath);
        }
    });

    const qtaTreeViewDataProvider = new QTATreeViewDataProvider();
    vscode.window.registerTreeDataProvider('qtaTreeView', qtaTreeViewDataProvider);

    let codelensProvider = new CodelensProvider(qtaTreeViewDataProvider);
    languages.registerCodeLensProvider("*", codelensProvider);
    // vscode.window.createTreeView('qtaTreeView', { treeDataProvider: qtaTreeViewDataProvider });

    vscode.commands.registerCommand('qta.extension.updateStatus', (text) => updateStatus(text));

    vscode.commands.registerCommand('qta.extension.view.refresh', (node?) => {
        if(node) {
            qtaTreeViewDataProvider.refresh(node);
        }
        else {
            qtaTreeViewDataProvider.refresh();
        }
    });
    vscode.commands.registerCommand('qta.extension.codelen.refresh', () => {
        codelensProvider.refresh();
    });
    vscode.commands.registerCommand('qta.extension.view.run', filePath => qtaTreeViewDataProvider.run(filePath));
    vscode.commands.registerCommand('qta.extension.view.runTestcase', filePath => qtaTreeViewDataProvider.runTestcase(filePath));
    vscode.commands.registerCommand('qta.extension.view.runTestcaseInline', () => qtaTreeViewDataProvider.runTestcaseInline());
    vscode.commands.registerCommand('qta.extension.view.openFile', (filePath, line) => qtaTreeViewDataProvider.openFile(filePath, line));

    let disposable = vscode.commands.registerCommand('extension.sayHello', async () => {
        vscode.window.showInformationMessage('Hello QTA!');
    });

    vscode.window.onDidChangeActiveTextEditor(async editor => {
        if (!editor) {
            return;
        }
        vscode.commands.executeCommand('qta.extension.view.refresh');
    });

    vscode.workspace.onDidSaveTextDocument(async () => {
        vscode.commands.executeCommand('qta.extension.view.refresh');
    });

    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
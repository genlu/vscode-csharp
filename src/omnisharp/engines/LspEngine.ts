import * as protocol from '../protocol';
import { CancellationToken } from '../../vscodeAdapter';
import { LaunchTarget } from '../launcher';
import { EventEmitter } from 'events';
import { LaunchInfo } from '../OmnisharpManager';
import { Options } from '../options';
import { setTimeout } from 'timers';
import * as ObservableEvents from '../loggingEvents';
import { EventStream } from '../../EventStream';
import CompositeDisposable from '../../CompositeDisposable';
import Disposable from '../../Disposable';
import {
    ServerOptions,
    LanguageClientOptions,
    LanguageClient,
    Trace,
    StaticFeature,
    RequestType0,
    DynamicFeature,
    CompletionRequest,
    HoverRequest,
    SignatureHelpRequest,
    DefinitionRequest,
    ReferencesRequest,
    DocumentHighlightRequest,
    DocumentSymbolRequest,
    WorkspaceSymbolRequest,
    CodeActionRequest,
    CodeLensRequest,
    DocumentFormattingRequest,
    DocumentRangeFormattingRequest,
    DocumentOnTypeFormattingRequest,
    RenameRequest,
    DocumentLinkRequest,
    ExecuteCommandRequest,
} from 'vscode-languageclient';
import {
    ExtensionContext,
    CancellationTokenSource,
    OutputChannel,
} from 'vscode';
import { ColorProviderFeature } from 'vscode-languageclient/lib/colorProvider';
import { FoldingRangeFeature } from 'vscode-languageclient/lib/foldingRange';
import { WorkspaceFoldersFeature } from 'vscode-languageclient/lib/workspaceFolders';
import { ImplementationFeature } from 'vscode-languageclient/lib/implementation';
import { DeclarationFeature } from 'vscode-languageclient/lib/declaration';
import { SelectionRangeFeature } from 'vscode-languageclient/lib/selectionRange';
import { TypeDefinitionFeature } from 'vscode-languageclient/lib/typeDefinition';
import {
    ProtocolNotificationType,
    ProtocolNotificationType0,
    ProtocolRequestType0,
    ProtocolRequestType,
} from 'vscode-languageserver-protocol/lib/messages';
import { LanguageMiddlewareFeature } from '../LanguageMiddlewareFeature';
import { Events } from '../server';
import { IEngine } from '../IEngine';

export class LspEngine implements IEngine {
    client: LanguageClient;
    constructor(
        private eventBus: EventEmitter,
        private eventStream: EventStream,
        private context: ExtensionContext,
        private outputChannel: OutputChannel,
        private disposables: CompositeDisposable,
        private languageMiddlewareFeature: LanguageMiddlewareFeature
    ) {}
    public async start(
        cwd: string,
        args: string[],
        launchTarget: LaunchTarget,
        launchInfo: LaunchInfo,
        options: Options
    ): Promise<void> {
        let serverOptions: ServerOptions = {
            run: {
                command: launchInfo.MonoLaunchPath ?? launchInfo.LaunchPath,
                args: ['-lsp'].concat(args),
                options: {
                    cwd,
                },
            },
            debug: {
                command: launchInfo.MonoLaunchPath ?? launchInfo.LaunchPath,
                args: [/*"-d", */ '-lsp'].concat(args),
                // args: ["-d", "-lsp"].concat(args),
                options: {
                    cwd,
                },
            },
        };

        const languageMiddlewareFeature = this.languageMiddlewareFeature;

        let clientOptions: LanguageClientOptions = {
            diagnosticCollectionName: 'csharp',
            progressOnInitialization: true,
            outputChannel: this.outputChannel,
            synchronize: {
                configurationSection: 'csharp',
            },
            middleware: {
                async provideDefinition(document, position, token, next) {
                    const result = await next(document, position, token);
                    return languageMiddlewareFeature.remap(
                        'remapLocations',
                        !Array.isArray(result) ? [result] : result,
                        token
                    );
                },
                async provideReferences(
                    document,
                    position,
                    options,
                    token,
                    next
                ) {
                    const result = await next(
                        document,
                        position,
                        options,
                        token
                    );
                    return languageMiddlewareFeature.remap(
                        'remapLocations',
                        result,
                        token
                    );
                },
                async provideImplementation(document, position, token, next) {
                    const result = await next(document, position, token);
                    return languageMiddlewareFeature.remap(
                        'remapLocations',
                        !Array.isArray(result) ? [result] : result,
                        token
                    );
                },
                // TODO: This uses range not locations
                // async provideCodeLenses(document, token, next) {
                //     const result = await next(document, token);
                //     return languageMiddlewareFeature.remap("remapLocations", result, token);
                // },
                async provideRenameEdits(
                    document,
                    position,
                    newName,
                    token,
                    next
                ) {
                    const result = await next(
                        document,
                        position,
                        newName,
                        token
                    );
                    return languageMiddlewareFeature.remap(
                        'remapWorkspaceEdit',
                        result,
                        token
                    );
                },
            },
        };

        const client = new LanguageClient(
            'csharp',
            'Omnisharp Server',
            serverOptions,
            clientOptions
        );

        // The goal here is to disable all the features and light them up over time.
        const features: (
            | StaticFeature
            | DynamicFeature<any>
        )[] = (client as any)._features;
        client.trace = Trace.Verbose;

        function disableFeature(ctor: {
            new (...args: any[]): StaticFeature | DynamicFeature<any>;
        }): void;
        function disableFeature(ctor: {
            type:
                | ProtocolNotificationType<any, any>
                | ProtocolNotificationType0<any>;
        }): void;
        function disableFeature(ctor: {
            type:
                | ProtocolRequestType<any, any, any, any, any>
                | ProtocolRequestType0<any, any, any, any>;
        }): void;
        function disableFeature(ctor: any) {
            let index = ctor.type
                ? features.findIndex((z) => (z as any).messages == ctor.type)
                : features.findIndex((z) => z instanceof ctor);
            if (index > -1) {
                features.splice(index, 1);
            }
        }
        disableFeature(CompletionRequest);
        disableFeature(HoverRequest);
        disableFeature(SignatureHelpRequest);
        disableFeature(DefinitionRequest);
        disableFeature(ReferencesRequest);
        disableFeature(DocumentHighlightRequest);
        disableFeature(DocumentSymbolRequest);
        disableFeature(WorkspaceSymbolRequest);
        disableFeature(CodeActionRequest);
        disableFeature(CodeLensRequest);
        disableFeature(DocumentFormattingRequest);
        disableFeature(DocumentRangeFormattingRequest);
        disableFeature(DocumentOnTypeFormattingRequest);
        disableFeature(RenameRequest);
        disableFeature(DocumentLinkRequest);
        disableFeature(ExecuteCommandRequest);
        disableFeature(TypeDefinitionFeature);
        disableFeature(SelectionRangeFeature);
        disableFeature(ImplementationFeature);
        disableFeature(ColorProviderFeature);
        disableFeature(WorkspaceFoldersFeature);
        disableFeature(FoldingRangeFeature);
        disableFeature(DeclarationFeature);

        client.registerFeature(this.createInteropFeature(client));
        const disposable = client.start();
        this.client = client;

        this.disposables.add(disposable);
        this.context.subscriptions.push(disposable);
        this.eventStream.post(
            new ObservableEvents.OmnisharpLaunch('', '', '', -1)
        );
        return this.client.onReady();
    }
    stop(): Promise<void> {
        return this.client.stop();
    }
    async waitForInitialize(): Promise<void> {
        while (!(await this.client.sendRequest(this.readyStatus))) {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    dispose(): void {
        this.disposables.dispose();
    }
    async makeRequest<TResponse>(
        command: string,
        data?: any,
        token?: CancellationToken
    ): Promise<TResponse> {
        // TOOD: Add trim?
        const response = await this.client.sendRequest<TResponse>(
            `o#/${command}`.replace(/\/\//g, '/').toLowerCase(),
            data || {},
            token ?? new CancellationTokenSource().token
        );
        return response;
    }

    public addListener<T = {}>(
        event: string,
        listener: (e: T) => void
    ): Disposable {
        const eventName = `o#/${event}`.replace(/\/\//g, '/').toLowerCase();
        this.eventBus.addListener(eventName, listener);
        return new Disposable(() =>
            this.eventBus.removeListener(eventName, listener)
        );
    }

    private readyStatus = new RequestType0<boolean, void>(
        'o#/checkreadystatus'
    );

    private createInteropFeature = (client: LanguageClient): StaticFeature => {
        return {
            fillClientCapabilities(capabilities) {},
            initialize: (capabilities, documentSelector) => {
                client.onNotification(
                    'o#/log',
                    (packet: protocol.WireProtocol.EventPacket) => {
                        const entry = <
                            { LogLevel: string; Name: string; Message: string }
                        >packet.Body;
                        this.eventStream.post(
                            new ObservableEvents.OmnisharpEventPacketReceived(
                                entry.LogLevel,
                                entry.Name,
                                entry.Message
                            )
                        );
                    }
                );
                for (const event of Object.values(Events)) {
                    if (typeof event !== 'string') continue;
                    const eventName = `o#/${event}`
                        .replace(/\/\//g, '/')
                        .toLowerCase();
                    client.onNotification(eventName, (eventBody: any) =>
                        this.eventBus.emit(event, eventBody)
                    );
                }
            },
        };
    };
}

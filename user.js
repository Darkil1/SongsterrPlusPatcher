// ==UserScript==
// @name         Songsterr Plus Patcher
// @namespace    https://github.com/Strikeless
// @version      1.5.2
// @description  Trick Songsterr to unlock plus features. Fully bypasses SW errors and unlocks the UI.
// @license      MIT
// @supportURL   https://github.com/Strikeless/SongsterrPlusPatcher
// @match        http*://*.songsterr.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM.xmlHttpRequest
// @contributor Darkil1
// ==/UserScript==

/*
Copyright 2026, https://github.com/Strikeless
*/

(function () {
    'use strict';

    const common = {
        cfg: {
            enablePlusPatches: true,
            enableLateFixes: true,
            debugSourcePatcher: false,
            debugSiteEvents: null,
            cancelSiteEventCuriosity: false,
            cancelSiteOtherCuriosity: true,
            cancelSitePromo: true,
            cancelSiteExperiments: true
        },
        log: function (...args) {
            console.log("[SongsterrPlusPatcher] " + args.join(" "));
        },
        warn: function (...args) {
            console.warn("[SongsterrPlusPatcher] " + args.join(" "));
        },
        broken: function (msg) {
            this.log("Broken: " + msg);
            window.alert("SongsterrPlusPatcher has detected it is broken due to site changes. Please disable the userscript until an update has been published to avoid problems, after which you may reload the page.");
            window.location.reload();
        }
    };

    if (typeof GM.xmlHttpRequest == "undefined") {
        window.alert("SongsterrPlusPatcher is definitely incompatible with your userscript manager. Please make sure you are on a recent version, or switch to Violentmonkey.");
        return;
    }

    const win = unsafeWindow || window;

    // --- PATCH 1: Destroy Service Worker ---
    // SW causes crashes when '?demo=enabled' is present in requests
    if ('serviceWorker' in win.navigator) {
        win.navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
                registration.unregister();
            }
        }).catch(e => common.log("SW Unregister failed: " + e));

        const origRegister = win.navigator.serviceWorker.register;
        win.navigator.serviceWorker.register = function() {
            common.log("Blocked Service Worker registration to prevent network errors.");
            return Promise.reject(new Error("Blocked by SongsterrPlusPatcher"));
        };
    }

    // --- PATCH 2: Hide '?demo=enabled' from URL ---
    const cleanUrl = (url) => {
        if (typeof url === 'string') {
            return url.replace(/([?&])demo=(enabled|disabled)&?/g, (m, p1) => p1 === '?' ? '?' : '').replace(/[?&]$/, '');
        } else if (url instanceof URL) {
            return url.toString().replace(/([?&])demo=(enabled|disabled)&?/g, (m, p1) => p1 === '?' ? '?' : '').replace(/[?&]$/, '');
        }
        return url;
    };

    const origPushState = win.history.pushState;
    win.history.pushState = function(state, title, url) {
        return origPushState.call(this, state, title, cleanUrl(url));
    };

    const origReplaceState = win.history.replaceState;
    win.history.replaceState = function(state, title, url) {
        return origReplaceState.call(this, state, title, cleanUrl(url));
    };

    const origFetch = win.fetch;
    win.fetch = async function(...args) {
        if (args[0]) {
            if (typeof args[0] === 'string' || args[0] instanceof URL) {
                args[0] = cleanUrl(args[0]);
            } else if (args[0] instanceof Request && args[0].url.includes('demo=')) {
                args[0] = new Request(cleanUrl(args[0].url), args[0]);
            }
        }
        return origFetch.apply(this, args);
    };

    const origOpen = win.XMLHttpRequest.prototype.open;
    win.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        return origOpen.call(this, method, cleanUrl(url), ...rest);
    };
    // ------------------------------------------------------------------

    const commonObjectGlobalIdentifier = "_" + crypto.randomUUID().replaceAll("-", "");
    Object.defineProperty(
        win,
        commonObjectGlobalIdentifier,
        {
            value: common,
            writable: false,
            configurable: false,
            enumerable: false
        }
    );

    const appClientEntryHook = async function (common) {
        common.log("Hello from patched appClient entry hook!");

        function patchStateData(state) {
            // We must keep demo mode active, otherwise the UI won't unlock the buttons
            if (!state.demo) state.demo = {};
            state.demo.active = true;
            state.demo.enabled = true;
            
            if (!state.query) state.query = {};
            state.query.demo = "enabled";
            
            if (!state.queryContent) state.queryContent = {};
            state.queryContent.demo = "enabled";

            if (!state.bonus) state.bonus = {};
            state.bonus.activatingPlus = true;

            // Simulate a real subscription in the user profile
            if (!state.user) state.user = {};
            state.user.hasPlus = true;
            if (!state.user.profile) state.user.profile = {};
            state.user.profile.plan = "plus";
            state.user.profile.sra_license = "active";
            state.user.profile.sri_license = "active";
            
            return state;
        }

        function applyStateDataPatch() {
            const stateJsonElement = document.getElementById("state");
            if (stateJsonElement) {
                try {
                    const stateData = JSON.parse(stateJsonElement.innerHTML);
                    stateJsonElement.innerHTML = JSON.stringify(patchStateData(stateData));
                } catch(e) {}
            }

            // Patch the new server access snippet
            const snapshotElement = document.getElementById("server-plus-access-snapshot");
            if (snapshotElement) {
                try {
                    const snapshotData = JSON.parse(snapshotElement.innerHTML);
                    snapshotData.hasPlus = true;
                    snapshotData.permanentEditorBonus = true;
                    snapshotElement.innerHTML = JSON.stringify(snapshotData);
                } catch(e) {}
            }
        }

        if (common.cfg.enablePlusPatches) {
            applyStateDataPatch();
            document.getElementById("app")?.remove();
        }
    };

    const appClientContextHook = async function (common, ctx, store) {
        common.log("Hello from patched appClient context hook!");

        function lateUiHook() {
            if (common.cfg.enableLateFixes) {
                const url = new URL(window.location.href);
                if (url.searchParams.has("demo")) {
                    url.searchParams.delete("demo");
                    window.history.replaceState({}, "", url);
                }

                const demoLinkElements = document.querySelectorAll("a[href*='?demo=']");
                for (const demoLinkElement of demoLinkElements) {
                    demoLinkElement.href = demoLinkElement.href
                        .replace(/([?&])demo=(enabled|disabled)&?/g, (m, p1) => p1 === '?' ? '?' : '')
                        .replace(/[?&]$/, '');
                }

                const demoSongMarkerElement = document.querySelector("a[class*='_demo']");
                demoSongMarkerElement?.remove();
            }
        }

        const genuineStoreDispatchFunc = store.dispatch;
        function storeDispatchHook(eventIdentifier, ...eventDataArgs) {
            switch (eventIdentifier) {
                case "experiments/activate": {
                    const experimentName = eventDataArgs[0]?.experimentName;
                    if (experimentName == "plus_freeriders") {
                        common.broken("Experiment plus_freeriders was activated");
                    }
                    return;
                }
                case "demo/deactivate": {
                    return; // Block deactivation of demo mode
                }
                case "@changed": {
                    const changedState = eventDataArgs[0];
                    if (changedState.layer != null || (changedState.runningThunks != null && Object.keys(changedState.runningThunks).length == 0)) {
                        setTimeout(lateUiHook, 50);
                    }
                    break;
                }
                default: {
                    if (eventIdentifier.startsWith("curiosity") && common.cfg.cancelSiteOtherCuriosity) return;
                    if (eventIdentifier.startsWith("promo") && common.cfg.cancelSitePromo) return;
                    break;
                }
            }
            return genuineStoreDispatchFunc(eventIdentifier, ...eventDataArgs);
        }
        Object.defineProperty(store, "dispatch", { value: storeDispatchHook });
    };

    function fixRelocatedScriptRelatives(src, scriptOriginalSourceUrl) {
        return src.replaceAll(/["'`](\.+\/[^"'`]+.js)["'`]/g, (match, capturedPath) => {
            return `"${new URL(capturedPath, scriptOriginalSourceUrl).href}"`;
        });
    }

    async function patchAppClientScriptSource(src, originalSourceUrl) {
        if (common.cfg.enablePlusPatches) {
            // Patch the demo song ID (27) taking into account different minification variants
            src = src
                .replaceAll("===27", "===27 || true")
                .replaceAll("!==27", "!==27 && false")
                .replaceAll("=== 27", "=== 27 || true")
                .replaceAll("!== 27", "!== 27 && false")
                .replace(/\w+\(window\.location\.pathname\)/g, '27');
        }

        src = `await (${appClientEntryHook.toString()})(window.${commonObjectGlobalIdentifier});\n${src}`;

        const ctxStoreDefinitionMatch = src.match(/(\w+)=(\w+)\.get\(\w+\.Store\)[^;]*;/);
        if (ctxStoreDefinitionMatch) {
            const [ctxStoreDefinition, storeVariableIdentifier, ctxVariableIdentifier] = ctxStoreDefinitionMatch;
            const contextHook = `await (${appClientContextHook.toString()})(window.${commonObjectGlobalIdentifier}, ${ctxVariableIdentifier}, ${storeVariableIdentifier});`;
            src = src.replace(ctxStoreDefinition, `${ctxStoreDefinition}${contextHook}`);
        }

        return src;
    }

    function patchAndDivertAppClient() {
        const appClientElement = document.querySelector("script[src*='appClient']");
        const appClientSrcUrl = appClientElement?.src;
        if(!appClientSrcUrl) return;

        common.log("Fetching appClient from: " + appClientSrcUrl);

        GM.xmlHttpRequest({
            url: appClientSrcUrl,
            anonymous: true,
            onload: async scriptSourceResponse => {
                const scriptSource = scriptSourceResponse.responseText;
                const scriptSourceFixed = fixRelocatedScriptRelatives(scriptSource, appClientSrcUrl);
                const scriptSourcePatched = await patchAppClientScriptSource(scriptSourceFixed, appClientSrcUrl);

                let patchedScriptElement = document.createElement("script");
                patchedScriptElement.async = true;
                patchedScriptElement.type = "module";
                patchedScriptElement.crossOrigin = "anonymous";
                patchedScriptElement.textContent = scriptSourcePatched;
                document.body.appendChild(patchedScriptElement);
            }
        });

        throw new Error("Stopping execution of original script prematurely. THIS IS INTENTIONAL BEHAVIOR, YOU MAY DISREGARD.");
    }

    let appInitializedValue = null;
    let appClientPatched = false;
    Object.defineProperty(
        win,
        "__APP_INITIALISED",
        {
            get() {
                if (!appClientPatched) {
                    appClientPatched = true;
                    patchAndDivertAppClient();
                }
                return appInitializedValue;
            },
            set(value) {
                appInitializedValue = value;
            }
        }
    );
})();

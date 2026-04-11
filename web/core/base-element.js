import { appStore } from './store.js';
import { installTooltips } from './tooltip.js?v=20260407-1';

const TOKEN_STYLESHEET_SELECTOR =
    'link[rel="stylesheet"][href*="xdatahub-color-tokens.css"]';
const FALLBACK_TOKEN_STYLESHEET_URL = 'xdatahub-color-tokens.css';

let cachedTokenStylesheetUrl = '';

function getTokenStylesheetUrl() {
    if (cachedTokenStylesheetUrl) {
        return cachedTokenStylesheetUrl;
    }
    const linkEl = document.querySelector(TOKEN_STYLESHEET_SELECTOR);
    const href = linkEl?.getAttribute('href');
    cachedTokenStylesheetUrl = href || FALLBACK_TOKEN_STYLESHEET_URL;
    return cachedTokenStylesheetUrl;
}

export function registerCustomElement(tagName, elementClass) {
    const existing = customElements.get(tagName);
    if (!existing) {
        customElements.define(tagName, elementClass);
        return elementClass;
    }
    return existing;
}

export class BaseElement extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._storeUnsubscribe = null;
    }

    connectedCallback() {
        this.renderRoot();
        installTooltips(this.shadowRoot);
        if (this.onStoreUpdate) {
            this._storeUnsubscribe = appStore.subscribe((state, key, value) => {
                this.onStoreUpdate(state, key, value);
            });
        }
    }

    disconnectedCallback() {
        if (this._storeUnsubscribe) {
            this._storeUnsubscribe();
            this._storeUnsubscribe = null;
        }
    }

    /**
     * Internal method to render and bind events.
     * Derived classes should override `render()` and `bindEvents()`.
     */
    renderRoot() {
        if (!this.shadowRoot) return;

        // Inject the static core <style> only once per element lifetime.
        // Replacing it on every render forces the browser to re-parse
        // @import and all CSS rules, which is the main perf bottleneck.
        if (!this._coreStyleEl) {
            this._coreStyleEl = document.createElement('style');
            this._coreStyleEl.textContent = `
                @import url('${getTokenStylesheetUrl()}');
                :host {
                    box-sizing: border-box;
                    display: block;
                }
                *, *:before, *:after {
                    box-sizing: inherit;
                }
                ${this.constructor.styles || ''}
            `;
            this.shadowRoot.insertBefore(
                this._coreStyleEl,
                this.shadowRoot.firstChild
            );
        }

        // Replace content nodes (everything after the core style element).
        const content = this.render ? this.render() : '<slot></slot>';
        // Remove stale content nodes but keep _coreStyleEl
        let node = this._coreStyleEl.nextSibling;
        while (node) {
            const next = node.nextSibling;
            node.remove();
            node = next;
        }
        const tmp = document.createElement('template');
        tmp.innerHTML = content;
        this.shadowRoot.appendChild(tmp.content);

        if (this.bindEvents) {
            this.bindEvents();
        }
    }

    /**
     * Utility to safely select elements inside shadow DOM
     */
    $(selector) {
        return this.shadowRoot.querySelector(selector);
    }

    $$(selector) {
        return this.shadowRoot.querySelectorAll(selector);
    }
}

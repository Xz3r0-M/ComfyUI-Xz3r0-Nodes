import { BaseElement } from '../core/base-element.js';

export class XdhButton extends BaseElement {
    static get observedAttributes() {
        return ['variant', 'disabled', 'icon'];
    }

    constructor() {
        super();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this.shadowRoot) {
            this.renderRoot();
        }
    }

    render() {
        const variant = this.getAttribute('variant') || 'primary';
        const disabled = this.hasAttribute('disabled');
        const icon = this.getAttribute('icon');

        // This leverages CSS tokens from xdatahub-color-tokens.css
        return `
            <style>
                button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 8px 16px;
                    font-size: 14px;
                    font-weight: 500;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    outline: none;
                }

                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                button.primary {
                    background: var(--xdh-color-primary, #0066cc);
                    color: white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                button.primary:hover:not(:disabled) {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                }

                button.secondary {
                    background: var(--xdh-color-surface-2, #333);
                    color: var(--xdh-color-text-primary, #eee);
                    border: 1px solid var(--xdh-color-border, #444);
                }

                button.secondary:hover:not(:disabled) {
                    background: var(--xdh-color-surface-3, #444);
                }

                /* In compact mode, we might want to drop text and just show icon if a specific attribute is set,
                   but we agreed to avoid pure icon guesswork where possible. Still, for specific toolbars it might be needed. */
                @container (max-width: 300px) {
                    .text-label {
                        display: none;
                    }
                }
            </style>
            <button class="${variant}" ${disabled ? 'disabled' : ''}>
                ${icon ? `<span>${icon}</span>` : ''}
                <span class="text-label"><slot></slot></span>
            </button>
        `;
    }
}

customElements.define('xdh-button', XdhButton);

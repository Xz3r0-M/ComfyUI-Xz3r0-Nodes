const fs = require('fs');
let code = fs.readFileSync('web/components/xdh-media-grid.js', 'utf8');

code = code.replace(
    /constructor\(\) \{\s+super\(\);\s+this\.items = \[\];\s+\}/,
    \constructor() {
        super();
        this.items = [];
        this.lastSelectedIndex = -1;
    }\
);

const oldClick = \// Add to Staging Dock on click
            card.addEventListener('click', (e) => {
                const id = card.dataset.id;
                const currentSelected = [...appStore.state.selectedItems];      

                if (!currentSelected.includes(id)) {
                    currentSelected.push(id);
                    appStore.state.selectedItems = currentSelected;
                    card.classList.add('selected');
                } else {
                    appStore.state.selectedItems = currentSelected.filter(item => item !== id);
                    card.classList.remove('selected');
                }
            });\;

const newClick = \// Add to Staging Dock on click with Shift support
            card.addEventListener('click', (e) => {
                const id = card.dataset.id;
                let currentSelected = [...appStore.state.selectedItems];
                const currentIndex = Array.from(cards).indexOf(card);

                if (e.shiftKey && this.lastSelectedIndex !== -1) {
                    const start = Math.min(this.lastSelectedIndex, currentIndex);
                    const end = Math.max(this.lastSelectedIndex, currentIndex);
                    
                    for (let i = start; i <= end; i++) {
                        const targetId = cards[i].dataset.id;
                        if (!currentSelected.includes(targetId)) {
                            currentSelected.push(targetId);
                            cards[i].classList.add('selected');
                        }
                    }
                    appStore.state.selectedItems = currentSelected;
                } else {
                    if (!currentSelected.includes(id)) {
                        currentSelected.push(id);
                        appStore.state.selectedItems = currentSelected;
                        card.classList.add('selected');
                    } else {
                        currentSelected = currentSelected.filter(item => item !== id);
                        appStore.state.selectedItems = currentSelected;
                        card.classList.remove('selected');
                    }
                    this.lastSelectedIndex = currentIndex;
                }
            });\;

code = code.replace(oldClick, newClick);
fs.writeFileSync('web/components/xdh-media-grid.js', code);
console.log('done');

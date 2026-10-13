const english = document.documentElement.lang === 'en';
for (const block of document.querySelectorAll('.code-block:not(.diagram-source)')) {
  if (!navigator.clipboard) continue;
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.textContent = english ? 'Copy' : 'Copiar';
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(block.querySelector('code').textContent);
      button.textContent = english ? 'Copied' : 'Copiado';
    } catch {
      button.textContent = english ? 'Select the code' : 'Seleccionar el código';
    }
    setTimeout(() => { button.textContent = english ? 'Copy' : 'Copiar'; }, 2000);
  });
  block.append(button);
}
// Keep the readable Markdown diagram source if the optional renderer is unavailable.
if (document.querySelector('.diagram-source')) {
  import('https://cdn.jsdelivr.net/npm/mermaid@11.12.1/dist/mermaid.esm.min.mjs').then(async ({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: {
      primaryColor: '#f5f7fa', primaryTextColor: '#0B243F', primaryBorderColor: '#4DBE94',
      lineColor: '#6b7784', fontFamily: 'Lato, Arial, sans-serif',
    } });
    for (const [index, block] of [...document.querySelectorAll('.diagram-source')].entries()) {
      const { svg } = await mermaid.render(`diagram-${index}`, block.querySelector('code').textContent);
      const figure = document.createElement('div');
      figure.className = 'mermaid';
      figure.innerHTML = svg;
      block.before(figure);
      block.hidden = true;
    }
  }).catch(() => { /* The original diagram source remains accessible offline. */ });
}

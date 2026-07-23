export function requestTextInput(options: { title: string; placeholder?: string; value?: string; type?: 'text' | 'email' | 'password'; maxLength?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '1000', display: 'grid', placeItems: 'center', background: 'rgba(2,5,14,.82)', backdropFilter: 'blur(8px)' });
    const card = document.createElement('form');
    Object.assign(card.style, { width: 'min(90vw,440px)', padding: '26px', background: 'linear-gradient(145deg,#10253a,#050b16)', border: '1px solid #65dbe8', clipPath: 'polygon(4% 0,96% 0,100% 12%,100% 88%,96% 100%,4% 100%,0 88%,0 12%)', boxShadow: '0 24px 80px rgba(0,0,0,.6)', color: '#f2e8d4', fontFamily: 'Fusion Sans,Arial,sans-serif' });
    const title = document.createElement('h2'); title.textContent = options.title; Object.assign(title.style, { margin: '0 0 18px', fontSize: '22px', letterSpacing: '1px' });
    const input = document.createElement('input'); input.type = options.type ?? 'text'; input.placeholder = options.placeholder ?? ''; input.value = options.value ?? ''; input.maxLength = options.maxLength ?? 254; input.required = true;
    Object.assign(input.style, { boxSizing: 'border-box', width: '100%', padding: '14px 16px', border: '1px solid #33415a', background: '#030611', color: '#fff', fontSize: '18px', outline: 'none' });
    const controls = document.createElement('div'); Object.assign(controls.style, { display: 'flex', gap: '12px', marginTop: '18px' });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'CANCEL';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'CONTINUE';
    for (const button of [cancel, submit]) Object.assign(button.style, { flex: '1', padding: '12px', border: '1px solid #d4ac5c', background: button === submit ? '#17334a' : '#07101e', color: '#f2e8d4', fontWeight: '700', cursor: 'pointer' });
    controls.append(cancel, submit); card.append(title, input, controls); root.append(card); document.body.append(root); input.focus();
    const finish = (value: string | null) => { root.remove(); resolve(value); };
    cancel.onclick = () => finish(null); root.onclick = (event) => { if (event.target === root) finish(null); };
    card.onsubmit = (event) => { event.preventDefault(); finish(input.value.trim()); };
  });
}

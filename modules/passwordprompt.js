// Cross-browser password prompt (avoids blocked window.prompt in some browsers).

export function promptForPassword(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'password-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'password-dialog';

    const label = document.createElement('div');
    label.className = 'password-label';
    label.textContent = message || '';

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'password-input';
    input.setAttribute('autocomplete', 'off');

    const buttons = document.createElement('div');
    buttons.className = 'password-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary-btn';
    cancelBtn.textContent = 'გაუქმება';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'primary-btn';
    okBtn.textContent = 'გაგრძელება';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);

    dialog.appendChild(label);
    dialog.appendChild(input);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      overlay.remove();
    }

    function onOk() {
      const val = input.value || '';
      cleanup();
      resolve(val);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKeydown(event) {
      if (event.key === 'Enter') onOk();
      if (event.key === 'Escape') onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);

    setTimeout(() => input.focus(), 20);
  });
}

export const ADMIN_DELETE_CODE = '12345';

export async function verifyAdminDeleteCode(message) {
  const password = await promptForPassword(message || 'გთხოვთ, შეიყვანეთ კოდი');
  if (password === null) return false;
  if (password !== ADMIN_DELETE_CODE) {
    window.alert('არასწორი კოდი.');
    return false;
  }
  return true;
}

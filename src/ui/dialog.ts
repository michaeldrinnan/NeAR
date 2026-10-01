/** Promise-based modal message boxes, standing in for WinForms MessageBox. */

export interface DialogButton<T extends string> {
  label: string;
  value: T;
  primary?: boolean;
}

const TITLE = 'Newcastle Audio Ranking test';

/** Shows a modal; Escape picks the last button (Cancel / No / OK). */
export function ask<T extends string>(body: string | Node, buttons: DialogButton<T>[], title = TITLE): Promise<T> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const content = document.createElement('div');
  content.className = 'modal-body';
  if (typeof body === 'string') content.textContent = body;
  else content.append(body);
  const row = document.createElement('div');
  row.className = 'modal-buttons';
  dialog.append(heading, content, row);

  return new Promise<T>((resolve) => {
    const finish = (value: T) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', () => finish(b.value));
      row.append(btn);
    }
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(buttons[buttons.length - 1].value);
    });
    document.body.append(dialog);
    dialog.showModal();
    (row.querySelector('.primary') as HTMLElement | null)?.focus();
  });
}

export function alertBox(body: string | Node): Promise<'ok'> {
  return ask(body, [{ label: 'OK', value: 'ok', primary: true }]);
}

export function yesNo(body: string): Promise<'yes' | 'no'> {
  return ask(body, [
    { label: 'Yes', value: 'yes', primary: true },
    { label: 'No', value: 'no' },
  ]);
}

export function yesNoCancel(body: string): Promise<'yes' | 'no' | 'cancel'> {
  return ask(body, [
    { label: 'Yes', value: 'yes', primary: true },
    { label: 'No', value: 'no' },
    { label: 'Cancel', value: 'cancel' },
  ]);
}

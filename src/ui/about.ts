import { ask } from './dialog';

export function showAbout(): void {
  const body = document.createElement('div');
  body.className = 'about';
  body.innerHTML = `
    <p class="about-title">The Newcastle Audio Ranking Test</p>
    <dl>
      <dt>Version</dt><dd>${__APP_VERSION__} (web)</dd>
      <dt>Build date</dt><dd>${__BUILD_DATE__}</dd>
      <dt>For ideas, bug reports, suggestions and updates</dt><dd><a href="https://github.com/michaeldrinnan/NeAR/issues" target="_blank" rel="noopener">github.com/michaeldrinnan/NeAR/issues</a></dd>
      <dt>Original paper</dt><dd>Gould J, Waugh J, Carding P, Drinnan M. A new voice rating tool for clinical practice. <i>Journal of Voice</i> 2012; 26(4): e163–70. <a href="https://doi.org/10.1016/j.jvoice.2011.07.011" target="_blank" rel="noopener">doi:10.1016/j.jvoice.2011.07.011</a></dd>
      <dt>User manual</dt><dd><a href="./manual/NeAR-user-manual.pdf" target="_blank" rel="noopener">NeAR user manual (PDF)</a></dd>
      <dt>Acknowledgements (in alphabetical order)</dt>
      <dd>Meike Brockmann<br>Paul Carding<br>Jim Gould<br>Jessie Waugh</dd>
    </dl>
    <p>Thanks for trying out the NeAR test. If you've anything to tell us, good or bad, please feel free to get
      in touch. We'll think seriously about any ideas for the next version.</p>
    <p class="small">Your audio files never leave this device. After the first visit the app works offline.</p>`;
  void ask(body, [{ label: 'Okay', value: 'ok', primary: true }], 'About NeAR');
}

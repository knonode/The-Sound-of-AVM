import { render, renderFilled, PALETTES, getPaletteNames } from 'oh-my-logo';

// Basic ASCII art rendering
const logo = await render('HELLO WORLD', {
  palette: 'sunset',
  direction: 'horizontal'
});
console.log(logo);

// Using custom colors
const customLogo = await render('MY BRAND', {
  palette: ['#ff0000', '#00ff00', '#0000ff'],
  font: 'Big',
  direction: 'diagonal'
});
console.log(customLogo);

// Filled block characters
await renderFilled('AWESOME', {
  palette: 'fire'
});

// TypeScript usage
import { render, RenderOptions, PaletteName } from 'oh-my-logo';

const options: RenderOptions = {
  palette: 'ocean' as PaletteName,
  direction: 'vertical',
  font: 'Standard'
};

const typedLogo = await render('TYPESCRIPT', options);
console.log(typedLogo);

// Access palette information
console.log('Available palettes:', getPaletteNames());
console.log('Sunset colors:', PALETTES.sunset);
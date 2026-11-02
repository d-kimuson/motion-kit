import { afterEach, expect, it } from 'vitest';

import { inspectPoint } from './inspect.ts';

afterEach(() => document.body.replaceChildren());

const photo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8a6"/></svg>',
)}`;

/**
 * A shot as scenes draw one: a photo filling the frame, a title over it, film-look overlays that
 * cover the frame and take the pointer (a blended tone, a tint gradient, a light leak blended
 * through its parent), and a card on top.
 */
const shot = () => {
  const root = document.createElement('div');
  root.style.cssText = 'position: absolute; left: 0; top: 0; width: 320px; height: 180px';
  root.innerHTML = `
    <div class="shot" style="position: absolute; inset: 0">
      <img class="photo" src="${photo}" style="position: absolute; left: 0; top: 0; width: 320px; height: 180px">
      <div class="title" style="position: absolute; left: 40px; top: 20px; width: 240px; height: 60px; font: 20px/24px sans-serif">The morning of</div>
    </div>
    <div class="tone" style="position: absolute; inset: 0; background: rgba(255, 214, 170, 0.07); mix-blend-mode: soft-light"></div>
    <div class="tint" style="position: absolute; inset: 0; background: linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.3))"></div>
    <div class="leak" style="position: absolute; inset: 0; mix-blend-mode: screen">
      <div class="flare" style="position: absolute; left: 0; top: 150px; width: 30px; height: 30px; background: orange"></div>
    </div>
    <div class="card" style="position: absolute; left: 200px; top: 100px; width: 100px; height: 60px; background: white"></div>
  `;
  document.body.append(root);
  return root;
};

const selectors = (root: HTMLElement, x: number, y: number) =>
  inspectPoint(root, x, y).map(({ selector }) => selector);

it('ranks the text under the pointer first, then what paints there, film-look overlays and layout boxes last', () => {
  const root = shot();
  expect(selectors(root, 50, 30)).toEqual([
    'div.title',
    'img.photo',
    'div.tint',
    'div.tone',
    'div.leak',
    'div.shot',
  ]);
  expect(selectors(root, 250, 130)).toEqual([
    'div.card',
    'img.photo',
    'div.tint',
    'div.tone',
    'div.leak',
    'div.shot',
  ]);
  expect(selectors(root, 10, 165)).toEqual([
    'img.photo',
    'div.flare',
    'div.tint',
    'div.tone',
    'div.leak',
    'div.shot',
  ]);
});

it('ranks a text box by its paint where the pointer misses its glyphs', () => {
  const root = shot();
  // The title's line ends well before 270 and its glyphs end at 44.
  expect(selectors(root, 270, 70)).toEqual([
    'div.title',
    'img.photo',
    'div.tint',
    'div.tone',
    'div.leak',
    'div.shot',
  ]);
});

it('ranks text under a box that paints over it first when the pointer is on its glyphs', () => {
  const root = shot();
  root.insertAdjacentHTML(
    'beforeend',
    '<div class="veil" style="position: absolute; left: 0; top: 0; width: 320px; height: 90px; background: rgba(0, 0, 0, 0.2)"></div>',
  );
  expect(selectors(root, 50, 30).slice(0, 3)).toEqual(['div.title', 'div.veil', 'img.photo']);
});

it('finds nothing outside the root', () => {
  expect(inspectPoint(shot(), 400, 30)).toEqual([]);
});

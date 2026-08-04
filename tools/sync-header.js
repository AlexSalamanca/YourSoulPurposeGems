#!/usr/bin/env node
//
// Copies partials/header.html into every page, between the header:start and
// header:end markers.
//
//   node tools/sync-header.js          write the partial into every page
//   node tools/sync-header.js --check  report drift and exit 1, writing nothing
//
// Why a sync script and not a runtime include: the nav is the site's primary
// navigation, so it should be in the HTML that ships rather than injected by
// JavaScript. This keeps one editable source while the deployed pages stay plain
// static HTML, with no build step required on Vercel.
//
// First run inserts the markers around each page's existing <header> block.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PARTIAL = path.join(ROOT, 'partials/header.html');
const START = '<!-- header:start — generated from partials/header.html by tools/sync-header.js. Edit the partial, not this. -->';
const END = '<!-- header:end -->';

const check = process.argv.includes('--check');

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
if (!fs.existsSync(PARTIAL)) {
    console.error(`missing ${path.relative(ROOT, PARTIAL)}`);
    process.exit(1);
}

const header = fs.readFileSync(PARTIAL, 'utf8').replace(/\s+$/, '');
const block = `${START}\n${header}\n${END}`;

const changed = [];
const drifted = [];
const skipped = [];

for (const page of pages) {
    const file = path.join(ROOT, page);
    const html = fs.readFileSync(file, 'utf8');
    const eol = html.includes('\r\n') ? '\r\n' : '\n';
    const wanted = block.replace(/\n/g, eol);

    const markered = new RegExp(
        `${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`
    );

    let next;
    if (markered.test(html)) {
        next = html.replace(markered, wanted);
    } else if (/<header>[\s\S]*?<\/header>/.test(html)) {
        // First run: wrap the existing header in markers.
        next = html.replace(/[ \t]*<header>[\s\S]*?<\/header>/, wanted);
    } else {
        skipped.push(`${page} (no <header> and no markers)`);
        continue;
    }

    if (next === html) continue;

    if (check) {
        drifted.push(page);
    } else {
        fs.writeFileSync(file, next, 'utf8');
        changed.push(page);
    }
}

if (skipped.length) {
    console.log('skipped:');
    skipped.forEach(s => console.log(`  ${s}`));
}

if (check) {
    if (drifted.length) {
        console.error(`header out of sync with the partial in ${drifted.length} page(s):`);
        drifted.forEach(p => console.error(`  ${p}`));
        console.error('\nrun: npm run sync-header');
        process.exit(1);
    }
    console.log(`all ${pages.length - skipped.length} page(s) match partials/header.html`);
} else {
    console.log(changed.length
        ? `updated ${changed.length} page(s):\n  ${changed.join('\n  ')}`
        : `already in sync (${pages.length - skipped.length} page(s))`);
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

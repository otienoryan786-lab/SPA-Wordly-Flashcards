# Wordly Learn

A single-page English dictionary and vocabulary practice app built with HTML, CSS, and JavaScript.

## Run locally

Open `index.html` with VS Code Live Server (or another local web server). The app uses Wiktionary, Datamuse, and Bootstrap from their public services/CDNs, so an internet connection is needed for dictionary lookups and the external styles/scripts.

## Features

- Search for English words and view definitions, example sentences, synonyms, pronunciation data when available, and source links. The Listen button uses browser speech synthesis.
- Save and remove vocabulary; saved words are stored in the current browser.
- Review saved terms with flashcards and track words marked as learned.
- Switch between light and dark themes.
- Search synonyms directly and reopen saved words from the vocabulary list.

Definitions and example sentences come from the [Wiktionary REST API](https://en.wiktionary.org/api/rest_v1/), with [Datamuse](https://www.datamuse.com/api/) providing synonyms and pronunciation data. If Wiktionary is unavailable, the app falls back to Datamuse definitions. Wiktionary text is available under CC BY-SA; Datamuse currently allows keyless requests, but its documentation says an API key will be required starting February 1, 2027. Saved words and theme preference use browser `localStorage`.# SPA-Wordly-Flashcards

# Resume Evaluator

A pre-application check tool that compares your resume against a job posting using Claude AI. Upload your resume, provide a posting link or paste the text, and get a breakdown of blockers, requirement gaps, red flags with suggested fixes, ATS keyword matches, similar open roles, and likely interview questions.

## Features

- Resume upload (.docx, .txt, .md) or paste
- Job posting via URL (fetched live), file upload, or paste
- Optional extra notes and reference links (Glassdoor, LinkedIn, etc.)
- Verdict blinker (red / yellow / green) derived from real checks — no score
- Red flag cards with before/after rewrites; accept, edit, or keep original
- ATS keyword matching
- Similar open positions (live web search)
- Interview prep questions
- Translate results between the posting's language and English

## Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **AI**: Claude API (claude-sonnet-4-6) with web search tool

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy the env template and add your API key:
   ```
   cp .env.example .env
   ```
   Then open `.env` and paste your [Anthropic API key](https://console.anthropic.com).

3. Start both servers:
   ```
   npm run dev
   ```

The frontend runs on `http://localhost:5173` and the backend on `http://localhost:8788`.

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required) |
| `MODEL` | Claude model ID (default: `claude-sonnet-4-6`) |
| `PORT` | Backend port (default: `8788`) |

# Resume Evaluator

A tool I built for my own job search. It checks a resume against a specific job
posting and shows where they match and where they don't.

Source code for a tool I run in my own environment.

## What it does

- Compares your resume to a job posting and flags hard blockers (visa, clearance, degree, minimum experience)
- Shows which requirements you meet, which are missing, and which are fillable
- Reviews the resume for red flags and suggests rewrites
- Checks ATS keywords from the posting against your resume
- Finds similar open roles, sorted by salary
- Generates likely interview questions from the posting

## How it works

You paste in a resume and a job posting (or a posting URL), and the app uses the
Claude API to run the comparison and return the results. Built with React.

## Notes

I made this because I wanted one place to see the whole picture of an application
before submitting it. Built with AI assistance, and I'm still editing it as I use it.

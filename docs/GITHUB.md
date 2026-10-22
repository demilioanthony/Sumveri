# Publish the project on GitHub

1. Extract the archive on your computer.
2. Create a public GitHub repository named `sumveri`. Leave the initialization options unchecked; this folder already contains a README and ignore rules.
3. In the empty repository, choose **uploading an existing file**. Drag the contents of the extracted `sumveri` folder into the upload area, rather than uploading the ZIP or the outer folder.
4. Include `.github`, `.gitignore`, `.gitattributes`, and `.env.example`. Confirm that `.env`, `data`, and `node_modules` are absent.
5. Commit the files. Check that README.md appears on the repository home page and review the Actions tab for the test run.
6. Set the repository description to: Personal finance tracker with Plaid Sandbox, CSV imports, cash-flow analytics, and automated tests.
7. Suggested topics: personal-finance, javascript, nodejs, express, plaid, portfolio.
8. Pin the repository on your profile. Add a walkthrough video link to the README once the video is publicly accessible.

The full application requires a Node.js server. Uploading this repository does not deploy it, and GitHub Pages cannot run its backend. Local use is sufficient for this portfolio project.

For future updates, Git is more reliable than repeated browser uploads, especially for hidden files:

```bash
git init
git add .
git status
# Confirm no secrets or saved data are staged before committing.
git commit -m "Add Sumveri financial tracker"
git branch -M main
git remote add origin https://github.com/demilioanthony/sumveri.git
git push -u origin main
```

Use this remote only if you created that repository under your account. Keep the original local `.env` and saved data private, outside the clean upload folder.

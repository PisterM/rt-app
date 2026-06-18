RT App Web v1.4

This is a static browser version of RT App.

Files:
- index.html
- style.css
- app.js
- rt-app-icon.png
- favicon.ico

How to test locally:
1. Extract the zip.
2. Double-click index.html.
3. Use Space to start the test.

How to put on GitHub Pages:
1. Create a public GitHub repository, for example rt-app.
2. Upload the files in this folder directly into the repository root.
3. Go to Settings > Pages.
4. Choose:
   Source: Deploy from a branch
   Branch: main
   Folder: /root
5. Save and wait for GitHub to publish the site.

Notes:
- Results export as CSV.
- v1.1 improves the maximised-window layout, gives more space to the left-side stimulus/timer panel, and wraps table headings to reduce horizontal overflow.
- The app does not send or store data online. Results remain in the browser unless exported.
- Timing uses performance.now(), but browser/keyboard/OS timing is not lab-grade.

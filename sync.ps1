git add .
if ($?) {
    git commit -m "feat: sync latest changes from napcat-plugin-groupguard"
}
if ($?) {
    git push origin main
}

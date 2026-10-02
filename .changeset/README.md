# Releases

Run `yarn changeset` with each public API change. Choose patch for fixes, minor for compatible features, and major for breaking changes. The six public packages release together.

PR checks validate pending changesets. Merging into `master` runs verification, applies pending changesets, commits the version bump, publishes through npm trusted publishing, and creates GitHub releases. Documentation and CI-only changes can omit a changeset.

The Release workflow can also be run manually on `master` to recover an interrupted publish. Already published versions are skipped; registry errors stop the workflow.

The npm trusted publisher for each public package must allow publishing from owner `Niikelion`, repository `reactive-forge`, workflow `release.yml`, environment `Production`. No npm token is stored in GitHub.

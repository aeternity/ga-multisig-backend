# Changelog

## [1.1.2](https://github.com/aeternity/ga-multisig-backend/compare/v1.1.1...v1.1.2) (2023-11-19)


### CI / CD

* change gitops repo for stg ([200cfa6](https://github.com/aeternity/ga-multisig-backend/commit/200cfa6dd5f913b5d1dd371e25a518cdba16cbe0))


### Miscellaneous

* update sdk version ([1c590ef](https://github.com/aeternity/ga-multisig-backend/commit/1c590ef2ccea39474635b61bab8d00c98b1a8d2a))

## [1.1.1](https://github.com/aeternity/ga-multisig-backend/compare/v1.1.0...v1.1.1) (2023-05-11)


### Bug Fixes

* update for changed scope filtering in mdw ([324e4b5](https://github.com/aeternity/ga-multisig-backend/commit/324e4b5dd0a9c9c0434b5f4295047b0ff4031d4e))


### Miscellaneous

* add migration to reset signers db ([eb5aa2d](https://github.com/aeternity/ga-multisig-backend/commit/eb5aa2d4998e360cfd9e5d6ca83a6a0e7b6c079d))

## [1.1.0](https://github.com/aeternity/ga-multisig-backend/compare/v1.0.1...v1.1.0) (2023-02-07)


### Features

* add contract version to signer response ([1c9abf1](https://github.com/aeternity/ga-multisig-backend/commit/1c9abf18675bc5cccf0572e614287ecadc0bf258))


### CI / CD

* change branch for stg pipelines ([3abe1ca](https://github.com/aeternity/ga-multisig-backend/commit/3abe1ca53ad4b3d05be112c77fcc0c556300b8c7))
* check pr deployment state before sync ([f7272d7](https://github.com/aeternity/ga-multisig-backend/commit/f7272d75eb828228e3aad7567c5f1029ba938173))
* fix typo ([c8f0f5c](https://github.com/aeternity/ga-multisig-backend/commit/c8f0f5c20f5a4bc6dce5923ead2c72d2ab72aa8e))
* pipeline concurrency ([19c650a](https://github.com/aeternity/ga-multisig-backend/commit/19c650a951fb12d981f52d6199035ca994649798))
* rebase with main ([6aea9e9](https://github.com/aeternity/ga-multisig-backend/commit/6aea9e998d461d3fc14e4350d97ca05124f5cc5a))


### Miscellaneous

* update mdw websocket usage, update aci ([7d4359e](https://github.com/aeternity/ga-multisig-backend/commit/7d4359e9f4baef65d80aeeff696ea86791215231))

## [1.0.1](https://github.com/aeternity/ga-multisig-backend/compare/v1.0.0...v1.0.1) (2023-01-23)


### Miscellaneous

* fix docker run command ([65ac790](https://github.com/aeternity/ga-multisig-backend/commit/65ac790961b87c54375611a6e91b3ddbc04f1bc3))

## 1.0.0 (2023-01-18)


### ⚠ BREAKING CHANGES

* rename db fields, improve error handling
* use node-fetch, use npm, move mdw to env

### CI / CD

* **build:** add the gh action pipelines ([d5e44df](https://github.com/aeternity/ga-multisig-backend/commit/d5e44dfa46cd961bef02c5782863f5d0ca6cbc61))
* **build:** patch-deprecated-gh-action-steps ([a322462](https://github.com/aeternity/ga-multisig-backend/commit/a32246237724d5cde666738bb2c16670c08ce4ec))
* change image repository ([e0d634a](https://github.com/aeternity/ga-multisig-backend/commit/e0d634ab36bf3a70b3686e4df26db00843ab5721))
* fix main branch ([55d7c13](https://github.com/aeternity/ga-multisig-backend/commit/55d7c138f1febdb62c505984b185cba55ff7c25a))
* rename pipelines ([e6b8079](https://github.com/aeternity/ga-multisig-backend/commit/e6b807962115840d0c6f8b67469423052bbc811e))
* use v6 version gh actions for all steps in stg ([2d930a9](https://github.com/aeternity/ga-multisig-backend/commit/2d930a9b4b6744c1108788c71ce8e9d900510889))


### Refactorings

* remove compiler need ([70964f6](https://github.com/aeternity/ga-multisig-backend/commit/70964f67d6e24f1dd77bd0eb57e6e1b2f8092562))


### Miscellaneous

* remove db dump ([13d5119](https://github.com/aeternity/ga-multisig-backend/commit/13d511913e0a0e89bf68b1b4f00025908d291a70))
* rename db fields, improve error handling ([b2cc0e9](https://github.com/aeternity/ga-multisig-backend/commit/b2cc0e9455dd1db8cd54caef26defa09e6212fff))
* update dependencies ([98da6ff](https://github.com/aeternity/ga-multisig-backend/commit/98da6ff999b2ad72085b974a05fd2deb04cfac4a))
* use node-fetch, use npm, move mdw to env ([e2f391f](https://github.com/aeternity/ga-multisig-backend/commit/e2f391f2c2a8ce0882325be0dff619f8d065541f))

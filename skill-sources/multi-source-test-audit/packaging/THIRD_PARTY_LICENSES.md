# Third-party licenses

The Windows Runtime bundles only the exact wheel files listed in `wheel-lock.json`.

| Package | Version | License |
| --- | --- | --- |
| openpyxl | 3.1.5 | MIT |
| cryptography | 49.0.0 | Apache-2.0 OR BSD-3-Clause |
| cffi | 2.1.0 | MIT-0 |
| et_xmlfile | 2.0.0 | MIT |
| pycparser | 3.0 | BSD-3-Clause |

The release builder copies each wheel's distributed license material into the Runtime `LICENSES` directory.

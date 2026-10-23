"""Regression: ChatGPT OAuth must install without compiling OpenSSL on Intel macOS."""
import sys
from pathlib import Path
import unittest

from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parents[1]


class IntelMacDependencyTests(unittest.TestCase):
    def test_intel_mac_uses_compatible_cryptography_with_rs256_support(self):
        lines = (ROOT / 'requirements.txt').read_text(encoding='utf-8').splitlines()
        requirements = [Requirement(line) for line in lines if line.strip() and not line.lstrip().startswith('#')]
        jwt_reqs = [req for req in requirements if req.name.lower() == 'pyjwt']
        self.assertEqual(len(jwt_reqs), 1)
        self.assertIn('crypto', jwt_reqs[0].extras, 'RS256 verification must stay enabled')
        pins = [req for req in requirements if req.name.lower() == 'cryptography']
        self.assertEqual(len(pins), 1)
        pin = pins[0]
        self.assertIsNotNone(pin.marker)
        self.assertTrue(pin.marker.evaluate({'sys_platform': 'darwin', 'platform_machine': 'x86_64'}))
        self.assertFalse(pin.marker.evaluate({'sys_platform': 'darwin', 'platform_machine': 'arm64'}))
        self.assertFalse(pin.marker.evaluate({'sys_platform': 'linux', 'platform_machine': 'x86_64'}))
        self.assertIn('48.0.1', pin.specifier)
        self.assertNotIn('49.0.0', pin.specifier)
        self.assertNotIn('50.0.2', pin.specifier)

    def test_mac_installer_refuses_cryptography_source_builds(self):
        script = (ROOT / 'start_mac_linux.sh').read_text(encoding='utf-8')
        self.assertIn('python -m pip install --only-binary=cryptography -r requirements.txt', script)
        self.assertIn('python schema_manager.py', script)
        self.assertLess(script.index('--only-binary=cryptography'), script.index('python schema_manager.py'))


if __name__ == '__main__':
    unittest.main()

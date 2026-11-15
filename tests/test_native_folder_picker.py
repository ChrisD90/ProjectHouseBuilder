"""OS dialogs use platform tools, preserve Unicode paths and keep paths out of code."""
import subprocess
import unittest
from unittest.mock import patch
from native_folder_picker import choose_folder

class NativeFolderPickerTest(unittest.TestCase):
    def test_macos_native_dialog_and_cancel(self):
        value='/Users/test/Ordner mit ü und "Zeichen" $(nicht_ausführen)'
        with patch('native_folder_picker.sys.platform','darwin'),patch('native_folder_picker.subprocess.run',return_value=subprocess.CompletedProcess([],0,stdout=value+'\n',stderr='')) as run:
            self.assertEqual(choose_folder(value),value)
            command=run.call_args.args[0];self.assertEqual(command[0],'osascript');self.assertNotIn(value,command[-1]);self.assertIn('choose folder',command[-1]);self.assertEqual(run.call_args.kwargs['env']['PHB_FOLDER_INITIAL'],value)
        with patch('native_folder_picker.sys.platform','darwin'),patch('native_folder_picker.subprocess.run',return_value=subprocess.CompletedProcess([],0,stdout='',stderr='')):
            self.assertIsNone(choose_folder())

    def test_windows_uses_sta_system_folder_dialog(self):
        value='C:\\Users\\Jörg\\Dokumente'
        with patch('native_folder_picker.sys.platform','win32'),patch('native_folder_picker.subprocess.run',return_value=subprocess.CompletedProcess([],0,stdout='\ufeff'+value,stderr='')) as run:
            self.assertEqual(choose_folder(value),value)
            command=run.call_args.args[0];self.assertIn('-STA',command);self.assertIn('FolderBrowserDialog',command[-1]);self.assertNotIn(value,command[-1]);self.assertEqual(run.call_args.kwargs['env']['PHB_FOLDER_INITIAL'],value)

    def test_linux_native_dialog_cancel_and_error(self):
        with patch('native_folder_picker.sys.platform','linux'),patch('native_folder_picker.shutil.which',return_value='/usr/bin/zenity'),patch('native_folder_picker.subprocess.run',return_value=subprocess.CompletedProcess([],1,stdout='',stderr='')):
            self.assertIsNone(choose_folder('/home/test'))
        with patch('native_folder_picker.sys.platform','linux'),patch('native_folder_picker.shutil.which',return_value='/usr/bin/zenity'),patch('native_folder_picker.subprocess.run',return_value=subprocess.CompletedProcess([],1,stdout='',stderr='Cannot open display')):
            with self.assertRaisesRegex(ValueError,'System-Ordnerdialog'):choose_folder()

    def test_missing_dialog_or_timeout_is_a_recoverable_error(self):
        for exception in (FileNotFoundError(),subprocess.TimeoutExpired('osascript',180)):
            with patch('native_folder_picker.sys.platform','darwin'),patch('native_folder_picker.subprocess.run',side_effect=exception):
                with self.assertRaisesRegex(ValueError,'System-Ordnerdialog'):choose_folder()

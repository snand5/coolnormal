import importlib.util
import pathlib

SCRIPT = (pathlib.Path(__file__).resolve().parents[2] / "scripts" /
	  "update_data.py")


def load_update_script():
	spec = importlib.util.spec_from_file_location("update_data", SCRIPT)
	module = importlib.util.module_from_spec(spec)

	spec.loader.exec_module(module)
	return module

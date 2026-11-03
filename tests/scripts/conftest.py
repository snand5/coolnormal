import importlib.util
import pathlib
import sys

SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / "scripts"


def load_script(name):
	path = SCRIPTS / f"{name}.py"
	spec = importlib.util.spec_from_file_location(name, path)
	module = importlib.util.module_from_spec(spec)

	sys.modules[name] = module
	spec.loader.exec_module(module)
	return module


def load_update_script():
	return load_script("update_data")


def load_feed_script():
	load_update_script()
	return load_script("update_feed")

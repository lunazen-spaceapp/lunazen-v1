"""The notebooks in notebooks/ must run top to bottom without errors."""

from pathlib import Path

import nbformat
import pytest
from nbclient import NotebookClient

from lunazen.paths import KERNELS, ROOT

NOTEBOOKS = sorted((ROOT / "notebooks").glob("*.ipynb"))
needs_kernels = pytest.mark.skipif(not (KERNELS / "de440s.bsp").exists(), reason="run scripts/fetch_data.sh")


def run(path: Path):
    notebook = nbformat.read(path, as_version=4)
    NotebookClient(notebook, timeout=600, kernel_name="python3", resources={"metadata": {"path": str(path.parent)}}).execute()
    return notebook


@needs_kernels
@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.stem)
def test_notebook_runs(path):
    run(path)


def test_notebooks_are_committed_with_outputs():
    assert NOTEBOOKS
    for path in NOTEBOOKS:
        notebook = nbformat.read(path, as_version=4)
        assert any(c.get("outputs") for c in notebook.cells if c.cell_type == "code"), path.name

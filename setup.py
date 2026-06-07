"""Trail v2 — 任务填报 + 大模型辅助（Web 形态）。"""
from setuptools import setup, find_packages

setup(
    name="trail",
    version="0.2.0",
    description="任务填报工具 + 大模型辅助（Web 形态）",
    author="trent",
    packages=find_packages(),
    install_requires=[
        "fastapi>=0.110.0",
        "uvicorn[standard]>=0.27.0",
        "duckdb>=0.10.0",
        "pydantic>=2.5.0",
        "pyyaml>=6.0",
        "python-dateutil>=2.8.0",
    ],
    entry_points={
        "console_scripts": [
            "trail=cli.main:cli",
        ],
    },
    python_requires=">=3.11",
)

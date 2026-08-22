import os
from dataclasses import dataclass, field as fld
from .internals import helper


@dataclass(frozen=True)
class Worker:
    name: str

    def run(self):
        return self.name

    @staticmethod
    def describe():
        return "worker"


class WorkerPool:
    def __init__(self):
        self.workers = []

    def spawn(self, count=None):
        pass


def setup_environ(root=None):
    os.environ["ROOT"] = root


async def drain(pool):
    pass


def _private_helper():
    pass

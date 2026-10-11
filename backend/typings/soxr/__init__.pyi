import numpy as np
from numpy.typing import NDArray

# This integration uses only the documented int16 streaming format.
class ResampleStream:
    def __init__(self, in_rate: float, out_rate: float, num_channels: int,
                 dtype: str = "float32", quality: str = "HQ") -> None: ...
    def resample_chunk(self, x: NDArray[np.int16], last: bool = False) -> NDArray[np.int16]: ...

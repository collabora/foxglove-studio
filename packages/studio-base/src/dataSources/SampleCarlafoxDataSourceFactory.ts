// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@foxglove/studio-base/players/IterablePlayer";
import { BagIterableSource } from "@foxglove/studio-base/players/IterablePlayer/BagIterableSource";
import RandomAccessPlayer from "@foxglove/studio-base/players/RandomAccessPlayer";
import Ros1MemoryCacheDataProvider from "@foxglove/studio-base/randomAccessDataProviders/Ros1MemoryCacheDataProvider";
import WorkerBagDataProvider from "@foxglove/studio-base/randomAccessDataProviders/WorkerBagDataProvider";
import { getSeekToTime } from "@foxglove/studio-base/util/time";

import * as SampleCarlafoxLayout from "./SampleCarlafoxLayout.json";

class SampleCarlafoxDataSourceFactory implements IDataSourceFactory {
  id = "sample-carlafox";
  type: IDataSourceFactory["type"] = "sample";
  displayName = "Sample: CARLAFox";
  iconName: IDataSourceFactory["iconName"] = "FileASPX";
  hidden = true;
  sampleLayout = SampleCarlafoxLayout as IDataSourceFactory["sampleLayout"];

  private enableIterablePlayer = false;

  constructor(opt?: { useIterablePlayer: boolean }) {
    this.enableIterablePlayer = opt?.useIterablePlayer ?? false;
  }

  initialize(args: DataSourceFactoryInitializeArgs): ReturnType<IDataSourceFactory["initialize"]> {
    const bagUrl = "./carlafox_subset.bag";

    if (this.enableIterablePlayer) {
      const bagSource = new BagIterableSource({ type: "remote", url: bagUrl });
      return new IterablePlayer({
        source: bagSource,
        isSampleDataSource: true,
        name: "Created using CARLAFox\nby Collabora Ltd.",
        metricsCollector: args.metricsCollector,
        // Use blank url params so the data source is set in the url
        urlParams: {},
      });
    } else {
      const bagWorkerDataProvider = new WorkerBagDataProvider({ type: "remote", url: bagUrl });
      const messageCacheProvider = new Ros1MemoryCacheDataProvider(bagWorkerDataProvider, {
        unlimitedCache: args.unlimitedMemoryCache,
      });

      return new RandomAccessPlayer(messageCacheProvider, {
        isSampleDataSource: true,
        metricsCollector: args.metricsCollector,
        seekToTime: getSeekToTime(),
        name: "Created using the CARLAFox\nby Collabora Ltd.",
        // Use blank url params so the data source is set in the url
        urlParams: {},
      });
    }
  }
}

export default SampleCarlafoxDataSourceFactory;

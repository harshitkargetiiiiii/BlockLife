/** Minimal typing for the dev/test automation API exposed by the game. */
interface Window {
  GAME_TEST_API?: {
    ready: () => boolean
    assetsSettled: () => boolean
    getStats: () => Record<string, unknown>
    teleportPlayer: (position: [number, number, number]) => void
    teleportTo: (name: string) => boolean
    getTestLocations: () => string[]
    getPlayerDistrict: () => string
    getNpcPosition: (npcId: string) => [number, number, number] | null
    isNpcPanicking: (npcId: string) => boolean
    getAmbientCarPositions: () => Record<string, [number, number, number]>
    getTrafficState: () => {
      signal: { phase: string; remaining: number; vehicle: string; pedestrian: string }
      cars: {
        id: string
        state: string
        reason: string
        speed: number
        targetSpeed: number
        blockedTime: number
        position: [number, number]
      }[]
      pedestrians: {
        id: string
        state: string
        waitingAtCrosswalkId: string | null
        crossingCrosswalkId: string | null
        position: [number, number]
      }[]
      crosswalks: { id: string; occupied: boolean; hasWaitingPedestrian: boolean }[]
    }
    setNpcPosition: (id: string, position: [number, number], waypointIndex?: number) => void
    setAmbientCarPosition: (id: string, position: [number, number], targetIndex?: number) => void
    setDrivenCarPosition: (position: [number, number], yaw?: number) => void
    setSignalPhase: (phase: string) => void
    advanceSignalTime: (seconds: number) => void
    getVehiclePositions: () => Record<string, [number, number]>
    getAmbientCitizens: () => {
      id: string
      district: string
      state: string
      position: [number, number]
    }[]
    assertNoVehicleVehicleOverlaps: () => [string, string][]
    assertNoPersonPersonOverlaps: (minDistance?: number) => [string, string, number][]
    assertNoMovingPeopleOverlaps: (minDistance?: number) => [string, string, number][]
    getRoadGraphSummary: () => {
      version: number
      nodeCount: number
      segmentCount: number
      edgeCount: number
      destinationCount: number
      spawnPointCount: number
    }
    getRoadGraph: () => {
      version: number
      segments: {
        id: string
        kind: string
        districtId: string
        roadId: string
        points: [number, number][]
        length: number
      }[]
      edges: { fromSegmentId: string; toSegmentId: string; movement: string; cost: number }[]
    }
    getVehicleRouteState: (vehicleId: string) => {
      vehicleId: string
      mode: string
      destinationId: string | null
      segmentIds: string[]
      segmentIndex: number
      currentSegmentId: string | null
      segmentProgress: number
      totalCost: number
      graphVersion: number
      blockageReason: string
      recoveryStage: number
      replanCount: number
      tripsCompleted: number
      districtsVisited: string[]
      lastDestinationIds: string[]
      stoppedTime: number
      suspectTime: number
    } | null
    getAllVehicleRouteStates: () => {
      vehicleId: string
      mode: string
      destinationId: string | null
      segmentIds: string[]
      segmentIndex: number
      currentSegmentId: string | null
      blockageReason: string
      recoveryStage: number
      replanCount: number
      tripsCompleted: number
      districtsVisited: string[]
      stoppedTime: number
    }[]
    forceVehicleDestination: (vehicleId: string, destinationId: string) => void
    replanVehicleRoute: (vehicleId: string) => void
    getSegmentCongestion: () => {
      segmentId: string
      vehicleCount: number
      occupancyRatio: number
      stoppedVehicleCount: number
      speedRatio: number
      penalty: number
    }[]
    setSegmentBlocked: (segmentId: string, blocked: boolean) => void
    clearTrafficRecoveryState: (vehicleId: string) => void
    teleportAmbientVehicleToSegment: (
      vehicleId: string,
      segmentId: string,
      progress: number,
    ) => boolean
    getCompletedTrips: (vehicleId: string) => number
    getIntersectionIds: () => string[]
    getIntersectionState: (id: string) => {
      id: string
      phaseId: string
      phaseIndex: number
      remaining: number
      cycleLength: number
      permittedVehicleGroups: string[]
      permittedPedestrianGroups: string[]
      movements: number
      approaches: number
    } | null
    getSignalPlan: (id: string) => { cycleLength: number; phases: unknown[] } | null
    getMovementPermission: (id: string, approach: string) => 'green' | 'red' | null
    setIntersectionElapsed: (seconds: number) => void
    getCrossingPedestrians: (intersectionId: string) => {
      crossingId: string
      walkSignal: 'walk' | 'clearance' | 'dont_walk'
      occupied: boolean
      queued: string[]
      crossing: string[]
    }[]
    forceCitizenToCrossing: (citizenId: string, crossingId: string, t?: number) => boolean
    getPedestrianCrossingState: (citizenId: string) => {
      state: string
      crosswalkId: string | null
      waitTime: number
      position: [number, number]
    } | null
    setPedestrianCrossingDebug: (enabled: boolean) => void
    getCitizenTripState: (citizenId: string) => {
      citizenId: string
      phase: string
      destinationId: string | null
      routeEdgeIds: string[]
      crossingIds: string[]
      waypointIndex: number
      waypointCount: number
      tripsCompleted: number
      recoveryStage: number
      suspended: boolean
    } | null
    getCitizenDestinations: () => {
      id: string
      kind: string
      sectorId: string
      position: [number, number]
      capacity: number
      occupancy: number
      arrivalBehavior: string
    }[]
    forceCitizenDestination: (citizenId: string, destinationId: string) => boolean
    getPedestrianGraphSummary: () => {
      nodes: number
      edges: number
      crossings: number
      destinations: number
    }
    getDestinationOccupancy: (destinationId: string) => number
    replanCitizenTrip: (citizenId: string) => boolean
    setCitizenDestinationDebug: (enabled: boolean) => void
    forceCitizenPose: (citizenId: string, x: number, z: number, heading?: number) => boolean
    getCrosswalkVisualSpec: (crossingId: string) => {
      crossingId: string
      kind: string
      axis: string
      stripeCount: number
      padPositions: { id: string; kind: string; x: number; z: number }[]
      furniture: { id: string; kind: string; position: number[] }[]
      sectorIds: string[]
    } | null
    getCrosswalkVisualIds: () => string[]
    getCrosswalkFurniture: (crossingId: string) => { id: string; kind: string; position: number[] }[]
    validateCrosswalkVisuals: () => string[]
    setCrosswalkVisualDebug: (enabled: boolean) => void
    emitCrime: (type: string, position?: [number, number, number]) => { id: string } | null
    getCrimeEvents: () => {
      id: string
      type: string
      position: [number, number, number]
      sectorId: string
      severity: number
      status: string
      witnessedBy: string[]
      reportedBy?: string
    }[]
    getWantedState: () => {
      heat: number
      level: number
      status: string
      lastKnownPosition: [number, number, number] | null
      activeIncidentIds: string[]
    }
    setWantedLevel: (level: number) => void
    clearWanted: () => void
    forceWitnessReport: (citizenId: string, crimeId: string) => boolean
    getWitnessState: (citizenId: string) => {
      state: string
      eventId: string
      verdict: string
      reported: boolean
    } | null
    setCrimeDebug: (enabled: boolean) => void
    stealVehicle: (vehicleId: string) => boolean
    getVehicleCrimeState: (vehicleId: string) => {
      access: string
      stolen: boolean
      ownerId?: string
      health: number
      disabled: boolean
    }
    setVehicleHealth: (vehicleId: string, value: number) => void
    getVehicleOccupant: (vehicleId: string) => string | null
    forceOccupiedVehicleTheft: (vehicleId: string) => boolean
    getEjectedDrivers: () => {
      id: string
      vehicleId: string
      position: [number, number]
      heading: number
    }[]
    spawnPoliceResponse: (level: number) => number
    getPoliceUnits: () => {
      id: string
      kind: string
      state: string
      position: [number, number]
      health: number
      seesSuspect: boolean
    }[]
    getPoliceUnitState: (id: string) => string | null
    teleportPoliceUnit: (id: string, x: number, z: number) => boolean
    setPoliceState: (id: string, state: string) => void
    getArrestState: () => { arrestsMade: number; lastArrestAt: number | null }
    setPoliceDebug: (enabled: boolean) => void
    getPoliceRouteState: (unitId: string) => {
      mode: string
      segmentIds: string[]
      cursor: number
      targetSegmentId: string
      replanCount: number
    } | null
    getPoliceRouteMetrics: () => { totalReplans: number; activeRoutes: number }
    getNearestRoadDistance: (x: number, z: number) => number
    getPoliceCruisers: () => {
      id: string
      state: string
      position: [number, number]
      hasOfficers: boolean
    }[]
    getPoliceOfficers: () => {
      id: string
      state: string
      position: [number, number]
      cruiserId: string | null
      health: number
      seesSuspect: boolean
    }[]
    getPoliceCounts: () => { vehicles: number; officers: number }
    forcePoliceDismount: (suspectX: number, suspectZ: number) => number
    // ---- Missions & Activities (Mission Framework v1) ----
    getMissionDefinitions: () => { id: string; title: string; category: string; objectives: number }[]
    getMissionState: () => {
      activeMissionId: string | null
      attemptId: string | null
      objectiveIndex: number
      objectiveCount: number
      objectiveId: string | null
      objectiveKind: string | null
      objectiveDescription: string | null
      variables: Record<string, string | number | boolean>
      ownedEntities: string[]
      result: { outcome: string; reason: string | null } | null
    }
    getMissionAvailability: (missionId: string) => string
    getMissionHistory: () => Record<string, { completions: number; totalEarned: number; lastCompletedGameHours: number }>
    getMissionCooldownHours: (missionId: string) => number
    getMissionTargetVehicle: () => string | null
    setMissionTargetVehicle: (vehicleId: string) => boolean
    getMissionValidation: () => string[]
    startMission: (missionId: string) => boolean
    cancelMission: () => boolean
    retryMission: () => boolean
    forceMissionEvent: (event: Record<string, unknown>) => void
    teleportToMissionObjective: () => boolean
    setMissionDebug: (enabled: boolean) => void
    givePlayerWeapon: (id?: string) => void
    drawPlayerWeapon: () => void
    holsterPlayerWeapon: () => void
    setPlayerAmmo: (magazine: number, reserve: number) => void
    getWeaponState: () => {
      equipped: string | null
      pose: string
      magazine: number
      reserve: number
      reloading: boolean
    }
    firePlayerWeaponAt: (x: number, z: number) => {
      fired: boolean
      hit: boolean
      targetId?: string
      targetKind?: string
      incapacitated: boolean
    }
    setPlayerHealth: (value: number) => void
    getPlayerHealth: () => { health: number; incapacitated: boolean }
    respawnPlayer: (kind: 'arrest' | 'incapacitation') => void
    getRecoveryState: () => { active: boolean; kind: string | null }
    getActorHealth: (id: string) => { health: number; incapacitated: boolean }
    setActorHealth: (id: string, value: number) => void
    getDamageEvents: () => {
      id: string
      sourceId: string
      targetId: string
      targetKind: string
      amount: number
      kind: string
      incapacitated: boolean
    }[]
    setTrafficRoutingSeed: (seed: number) => void
    getSectorRegistry: () => {
      id: string
      name: string
      kind: string
      districtIds: string[]
      bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
    }[]
    getSectorRuntimeStates: () => {
      id: string
      lifecycle: string
      requestedLifecycle: string
      simulationTier: string
      generation: number
      visualsReady: boolean
      collidersReady: boolean
      loadDurationMs: number | null
      error: string | null
    }[]
    getCurrentSectorId: () => string
    getSectorState: (id: string) => {
      id: string
      lifecycle: string
      simulationTier: string
      visualsReady: boolean
      collidersReady: boolean
    } | null
    getSectorContentSummary: (id: string) => Record<string, number>
    getSectorForRoadSegment: (segmentId: string) => {
      primarySectorId: string
      touchedSectorIds: string[]
      boundaryCrossing: boolean
    } | null
    getVehicleRouteSectorSequence: (vehicleId: string) => string[]
    getSimulationTier: (id: string) => string
    forceLoadSector: (id: string) => boolean
    forceUnloadSector: (id: string) => boolean
    clearForcedSectors: () => void
    setStreamingEnabled: (enabled: boolean) => void
    setStreamingRings: (activeRing: number, warmRing: number) => void
    getStreamingMetrics: () => Record<string, number>
    validateSectorOwnership: () => string[]
    getGlobalRoadGraphVersion: () => number
    getAuthoringTemplates: () => Record<string, string[]>
    getCompiledSectorContent: (sectorId: string) => {
      sectorId: string
      buildings: number
      props: number
      citizens: number
      segments: number
      destinations: number
      walls: number
      lots: { id: string; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }[]
    } | null
    validateSectorAuthoring: (sectorId: string) => string[]
    getAuthoringSourceRef: (
      contentId: string,
    ) => { sectorId: string; templateId: string; localId: string } | null
    setWeather: (kind: string, options?: { instant?: boolean; intensity?: number }) => boolean
    getWeatherState: () => {
      kind: string
      targetKind: string
      transition: number
      intensity: number
      wetness: number
      manualOverride: boolean
      scheduled: string
      modifiers: { trafficSpeedFactor: number; rainStrength: number; fogDensity: number }
    }
    setWetness: (wetness: number) => void
    advanceWeather: (seconds: number) => void
    getVisibleCitizenCountByWeather: () => number
    enterApartment: () => void
    exitApartment: () => void
    getLocationMode: () => string
    getAppearance: () => { shirtColor: string; pantsColor: string; accentColor: string }
    setAppearance: (appearance: {
      shirtColor?: string
      pantsColor?: string
      accentColor?: string
    }) => void
    getVisibilityState: () => {
      enabled: boolean
      subjectId: string | null
      subjectKind: string | null
      registeredCount: number
      candidateCount: number
      faded: { id: string; opacity: number; targetOpacity: number; reason: string }[]
    }
    getRegisteredOccluders: () => string[]
    setOcclusionEnabled: (enabled: boolean) => void
    forceVisibilityRecheck: () => void
    getCharacterState: (id?: string) => {
      id: string
      activeVisual: string
      renderMode: string
      animState: string
      previousAnimState: string
      playbackRate: number
      speed: number
      resolvedSlots: string[]
      fallbackReason: string | null
      modelLoaded: boolean
    } | null
    setCharacterRenderMode: (mode: 'auto' | 'model' | 'primitive') => void
    forceCharacterAnimation: (role: 'idle' | 'walk' | 'run' | null) => void
    getCharacterAssetInfo: () => { id: string; modelPath: string; clips: string[]; bounds: unknown }
    setTime: (hour: number) => void
    setTimeScale: (scale: number) => void
    pauseWorld: (paused: boolean) => void
    setQuestState: (questId: string, state: string) => void
    giveItem: (itemId: string, quantity: number) => void
    // Vehicle Ownership v1 (issue #19) — DEV arrange for on-foot specs that need the drivable shell.
    vehicleGrant: (
      defId: string,
      opts?: { location?: 'parked' | 'recovery' | 'impound' | 'active'; anchorId?: string; condition?: number },
    ) => string | null
    resetGame: () => void
    saveGame: () => Promise<boolean>
    loadGame: () => Promise<boolean>
    interact: () => void
  }
}

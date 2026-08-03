// Tech Activity Report (TAR) Dummy Data - Multi-Location Support
// Properly structured for tar_data_service.js compatibility

const tarDummyData = {
	locations: {
		'Birmingham': {
			location: 'Birmingham',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 18, CMP: 8, CAN: 0, RRR: 0, LDT: 3 },
				7: { ASG: 15, CMP: 5, CAN: 0, RRR: 2, LDT: 1 },
				8: { ASG: 18, CMP: 9, CAN: 0, RRR: 0, LDT: 2 },
				11: { ASG: 15, CMP: 3, CAN: 1, RRR: 0, LDT: 0 },
				12: { ASG: 13, CMP: 5, CAN: 0, RRR: 1, LDT: 3 },
				13: { ASG: 12, CMP: 8, CAN: 0, RRR: 0, LDT: 0 },
				14: { ASG: 16, CMP: 7, CAN: 0, RRR: 2, LDT: 0 },
				15: { ASG: 20, CMP: 9, CAN: 1, RRR: 1, LDT: 2 },
				18: { ASG: 17, CMP: 5, CAN: 0, RRR: 1, LDT: 1 },
				19: { ASG: 15, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 18, completed: 8, cancelled: 0, exchanged: 0, pending: 10, redo: 0, ldt: 3, mileage: 300.7 },
				{ date: '05/07/2026', assigned: 15, completed: 5, cancelled: 0, exchanged: 0, pending: 10, redo: 2, ldt: 1, mileage: 126.7 },
				{ date: '05/08/2026', assigned: 18, completed: 9, cancelled: 0, exchanged: 0, pending: 9, redo: 0, ldt: 2, mileage: 377.4 },
				{ date: '05/11/2026', assigned: 15, completed: 3, cancelled: 1, exchanged: 0, pending: 11, redo: 0, ldt: 0, mileage: 95.5 },
				{ date: '05/12/2026', assigned: 13, completed: 5, cancelled: 0, exchanged: 0, pending: 8, redo: 1, ldt: 3, mileage: 289.8 },
				{ date: '05/13/2026', assigned: 12, completed: 8, cancelled: 0, exchanged: 0, pending: 4, redo: 0, ldt: 0, mileage: 107.6 },
				{ date: '05/14/2026', assigned: 16, completed: 7, cancelled: 0, exchanged: 0, pending: 9, redo: 2, ldt: 0, mileage: 137.1 },
				{ date: '05/15/2026', assigned: 20, completed: 9, cancelled: 1, exchanged: 0, pending: 10, redo: 1, ldt: 2, mileage: 327.4 },
				{ date: '05/18/2026', assigned: 17, completed: 5, cancelled: 0, exchanged: 0, pending: 12, redo: 1, ldt: 1, mileage: 197.1 },
				{ date: '05/19/2026', assigned: 15, completed: 0, cancelled: 0, exchanged: 0, pending: 15, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'David Sims', assigned: 72, completed: 32, cancelled: 2, exchanged: 0, pending: 38, redo: 2, ldt: 6, mileage: 687.3 },
				{ name: 'Zonate Grant', assigned: 68, completed: 29, cancelled: 1, exchanged: 0, pending: 38, redo: 3, ldt: 5, mileage: 623.8 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-1001', technician: 'David Sims', date: '05/06/2026', status: 'Completed', mileage: 11.5 },
				{ workOrderNum: 'WO-2026-1002', technician: 'Zonate Grant', date: '05/06/2026', status: 'Completed', mileage: 45.2 },
				{ workOrderNum: 'WO-2026-1003', technician: 'David Sims', date: '05/06/2026', status: 'Completed', mileage: 13.0 },
				{ workOrderNum: 'WO-2026-1004', technician: 'David Sims', date: '05/06/2026', status: 'Completed', mileage: 4.7 },
				{ workOrderNum: 'WO-2026-1005', technician: 'Zonate Grant', date: '05/06/2026', status: 'Completed', mileage: 64.4 }
			]
		},
		'Asheville': {
			location: 'Asheville',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 12, CMP: 5, CAN: 0, RRR: 1, LDT: 2 },
				7: { ASG: 10, CMP: 6, CAN: 1, RRR: 0, LDT: 1 },
				8: { ASG: 14, CMP: 7, CAN: 0, RRR: 1, LDT: 2 },
				11: { ASG: 11, CMP: 4, CAN: 0, RRR: 1, LDT: 1 },
				12: { ASG: 9, CMP: 5, CAN: 0, RRR: 0, LDT: 1 },
				13: { ASG: 13, CMP: 8, CAN: 0, RRR: 1, LDT: 0 },
				14: { ASG: 15, CMP: 6, CAN: 1, RRR: 0, LDT: 1 },
				15: { ASG: 17, CMP: 7, CAN: 0, RRR: 1, LDT: 2 },
				18: { ASG: 13, CMP: 6, CAN: 0, RRR: 0, LDT: 1 },
				19: { ASG: 12, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 12, completed: 5, cancelled: 0, exchanged: 0, pending: 7, redo: 1, ldt: 2, mileage: 245.3 },
				{ date: '05/07/2026', assigned: 10, completed: 6, cancelled: 1, exchanged: 0, pending: 3, redo: 0, ldt: 1, mileage: 178.2 },
				{ date: '05/08/2026', assigned: 14, completed: 7, cancelled: 0, exchanged: 0, pending: 7, redo: 1, ldt: 2, mileage: 289.5 },
				{ date: '05/11/2026', assigned: 11, completed: 4, cancelled: 0, exchanged: 0, pending: 7, redo: 1, ldt: 1, mileage: 156.7 },
				{ date: '05/12/2026', assigned: 9, completed: 5, cancelled: 0, exchanged: 0, pending: 4, redo: 0, ldt: 1, mileage: 201.4 },
				{ date: '05/13/2026', assigned: 13, completed: 8, cancelled: 0, exchanged: 0, pending: 5, redo: 1, ldt: 0, mileage: 132.8 },
				{ date: '05/14/2026', assigned: 15, completed: 6, cancelled: 1, exchanged: 0, pending: 8, redo: 0, ldt: 1, mileage: 198.3 },
				{ date: '05/15/2026', assigned: 17, completed: 7, cancelled: 0, exchanged: 0, pending: 10, redo: 1, ldt: 2, mileage: 267.9 },
				{ date: '05/18/2026', assigned: 13, completed: 6, cancelled: 0, exchanged: 0, pending: 7, redo: 0, ldt: 1, mileage: 187.1 },
				{ date: '05/19/2026', assigned: 12, completed: 0, cancelled: 0, exchanged: 0, pending: 12, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'Angelo Husain', assigned: 45, completed: 22, cancelled: 1, exchanged: 0, pending: 22, redo: 2, ldt: 5, mileage: 512.3 },
				{ name: 'Daven Hodge', assigned: 61, completed: 28, cancelled: 2, exchanged: 0, pending: 31, redo: 3, ldt: 6, mileage: 745.8 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-2001', technician: 'Angelo Husain', date: '05/06/2026', status: 'Completed', mileage: 22.3 },
				{ workOrderNum: 'WO-2026-2002', technician: 'Daven Hodge', date: '05/06/2026', status: 'Completed', mileage: 31.5 },
				{ workOrderNum: 'WO-2026-2003', technician: 'Angelo Husain', date: '05/07/2026', status: 'Completed', mileage: 18.7 },
				{ workOrderNum: 'WO-2026-2004', technician: 'Daven Hodge', date: '05/07/2026', status: 'Completed', mileage: 25.2 },
				{ workOrderNum: 'WO-2026-2005', technician: 'Angelo Husain', date: '05/08/2026', status: 'Completed', mileage: 14.6 }
			]
		},
		'Atlanta': {
			location: 'Atlanta',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 22, CMP: 10, CAN: 1, RRR: 1, LDT: 4 },
				7: { ASG: 19, CMP: 9, CAN: 0, RRR: 2, LDT: 3 },
				8: { ASG: 24, CMP: 11, CAN: 1, RRR: 1, LDT: 3 },
				11: { ASG: 21, CMP: 8, CAN: 1, RRR: 0, LDT: 2 },
				12: { ASG: 18, CMP: 7, CAN: 0, RRR: 2, LDT: 2 },
				13: { ASG: 20, CMP: 12, CAN: 0, RRR: 1, LDT: 1 },
				14: { ASG: 23, CMP: 10, CAN: 1, RRR: 1, LDT: 2 },
				15: { ASG: 26, CMP: 12, CAN: 1, RRR: 2, LDT: 3 },
				18: { ASG: 22, CMP: 9, CAN: 0, RRR: 1, LDT: 2 },
				19: { ASG: 20, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 22, completed: 10, cancelled: 1, exchanged: 0, pending: 11, redo: 1, ldt: 4, mileage: 385.2 },
				{ date: '05/07/2026', assigned: 19, completed: 9, cancelled: 0, exchanged: 0, pending: 10, redo: 2, ldt: 3, mileage: 312.8 },
				{ date: '05/08/2026', assigned: 24, completed: 11, cancelled: 1, exchanged: 0, pending: 12, redo: 1, ldt: 3, mileage: 421.6 },
				{ date: '05/11/2026', assigned: 21, completed: 8, cancelled: 1, exchanged: 0, pending: 12, redo: 0, ldt: 2, mileage: 267.3 },
				{ date: '05/12/2026', assigned: 18, completed: 7, cancelled: 0, exchanged: 0, pending: 11, redo: 2, ldt: 2, mileage: 298.4 },
				{ date: '05/13/2026', assigned: 20, completed: 12, cancelled: 0, exchanged: 0, pending: 8, redo: 1, ldt: 1, mileage: 195.7 },
				{ date: '05/14/2026', assigned: 23, completed: 10, cancelled: 1, exchanged: 0, pending: 12, redo: 1, ldt: 2, mileage: 287.9 },
				{ date: '05/15/2026', assigned: 26, completed: 12, cancelled: 1, exchanged: 0, pending: 13, redo: 2, ldt: 3, mileage: 445.2 },
				{ date: '05/18/2026', assigned: 22, completed: 9, cancelled: 0, exchanged: 0, pending: 13, redo: 1, ldt: 2, mileage: 334.6 },
				{ date: '05/19/2026', assigned: 20, completed: 0, cancelled: 0, exchanged: 0, pending: 20, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'Jordan Koetsier', assigned: 95, completed: 42, cancelled: 3, exchanged: 0, pending: 50, redo: 5, ldt: 10, mileage: 912.4 },
				{ name: 'Kenny Shin', assigned: 79, completed: 38, cancelled: 2, exchanged: 0, pending: 39, redo: 3, ldt: 7, mileage: 821.7 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-3001', technician: 'Jordan Koetsier', date: '05/06/2026', status: 'Completed', mileage: 35.2 },
				{ workOrderNum: 'WO-2026-3002', technician: 'Kenny Shin', date: '05/06/2026', status: 'Completed', mileage: 42.8 },
				{ workOrderNum: 'WO-2026-3003', technician: 'Jordan Koetsier', date: '05/07/2026', status: 'Completed', mileage: 28.1 },
				{ workOrderNum: 'WO-2026-3004', technician: 'Kenny Shin', date: '05/07/2026', status: 'Completed', mileage: 39.6 },
				{ workOrderNum: 'WO-2026-3005', technician: 'Jordan Koetsier', date: '05/08/2026', status: 'Completed', mileage: 31.4 }
			]
		},
		'Dallas': {
			location: 'Dallas',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 16, CMP: 7, CAN: 0, RRR: 1, LDT: 2 },
				7: { ASG: 14, CMP: 6, CAN: 1, RRR: 0, LDT: 1 },
				8: { ASG: 17, CMP: 8, CAN: 0, RRR: 1, LDT: 2 },
				11: { ASG: 15, CMP: 6, CAN: 0, RRR: 0, LDT: 1 },
				12: { ASG: 13, CMP: 5, CAN: 1, RRR: 1, LDT: 1 },
				13: { ASG: 14, CMP: 7, CAN: 0, RRR: 0, LDT: 0 },
				14: { ASG: 18, CMP: 8, CAN: 1, RRR: 1, LDT: 1 },
				15: { ASG: 19, CMP: 9, CAN: 0, RRR: 1, LDT: 2 },
				18: { ASG: 16, CMP: 7, CAN: 0, RRR: 0, LDT: 1 },
				19: { ASG: 15, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 16, completed: 7, cancelled: 0, exchanged: 0, pending: 9, redo: 1, ldt: 2, mileage: 289.3 },
				{ date: '05/07/2026', assigned: 14, completed: 6, cancelled: 1, exchanged: 0, pending: 7, redo: 0, ldt: 1, mileage: 201.5 },
				{ date: '05/08/2026', assigned: 17, completed: 8, cancelled: 0, exchanged: 0, pending: 9, redo: 1, ldt: 2, mileage: 315.8 },
				{ date: '05/11/2026', assigned: 15, completed: 6, cancelled: 0, exchanged: 0, pending: 9, redo: 0, ldt: 1, mileage: 187.2 },
				{ date: '05/12/2026', assigned: 13, completed: 5, cancelled: 1, exchanged: 0, pending: 7, redo: 1, ldt: 1, mileage: 223.6 },
				{ date: '05/13/2026', assigned: 14, completed: 7, cancelled: 0, exchanged: 0, pending: 7, redo: 0, ldt: 0, mileage: 156.4 },
				{ date: '05/14/2026', assigned: 18, completed: 8, cancelled: 1, exchanged: 0, pending: 9, redo: 1, ldt: 1, mileage: 267.9 },
				{ date: '05/15/2026', assigned: 19, completed: 9, cancelled: 0, exchanged: 0, pending: 10, redo: 1, ldt: 2, mileage: 356.7 },
				{ date: '05/18/2026', assigned: 16, completed: 7, cancelled: 0, exchanged: 0, pending: 9, redo: 0, ldt: 1, mileage: 234.1 },
				{ date: '05/19/2026', assigned: 15, completed: 0, cancelled: 0, exchanged: 0, pending: 15, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'Justin Parker', assigned: 72, completed: 32, cancelled: 2, exchanged: 0, pending: 38, redo: 2, ldt: 6, mileage: 687.3 },
				{ name: 'Mark Marquez', assigned: 68, completed: 29, cancelled: 1, exchanged: 0, pending: 38, redo: 3, ldt: 5, mileage: 623.8 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-4001', technician: 'Justin Parker', date: '05/06/2026', status: 'Completed', mileage: 28.5 },
				{ workOrderNum: 'WO-2026-4002', technician: 'Mark Marquez', date: '05/06/2026', status: 'Completed', mileage: 35.7 },
				{ workOrderNum: 'WO-2026-4003', technician: 'Justin Parker', date: '05/07/2026', status: 'Completed', mileage: 19.3 },
				{ workOrderNum: 'WO-2026-4004', technician: 'Mark Marquez', date: '05/07/2026', status: 'Completed', mileage: 41.2 },
				{ workOrderNum: 'WO-2026-4005', technician: 'Justin Parker', date: '05/08/2026', status: 'Completed', mileage: 23.8 }
			]
		},
		'Memphis': {
			location: 'Memphis',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 14, CMP: 6, CAN: 0, RRR: 1, LDT: 1 },
				7: { ASG: 12, CMP: 5, CAN: 1, RRR: 0, LDT: 0 },
				8: { ASG: 13, CMP: 6, CAN: 0, RRR: 1, LDT: 1 },
				11: { ASG: 11, CMP: 4, CAN: 1, RRR: 0, LDT: 0 },
				12: { ASG: 10, CMP: 4, CAN: 0, RRR: 1, LDT: 0 },
				13: { ASG: 12, CMP: 6, CAN: 0, RRR: 0, LDT: 0 },
				14: { ASG: 13, CMP: 5, CAN: 1, RRR: 1, LDT: 0 },
				15: { ASG: 15, CMP: 6, CAN: 0, RRR: 1, LDT: 1 },
				18: { ASG: 12, CMP: 5, CAN: 0, RRR: 0, LDT: 0 },
				19: { ASG: 11, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 14, completed: 6, cancelled: 0, exchanged: 0, pending: 8, redo: 1, ldt: 1, mileage: 212.3 },
				{ date: '05/07/2026', assigned: 12, completed: 5, cancelled: 1, exchanged: 0, pending: 6, redo: 0, ldt: 0, mileage: 145.8 },
				{ date: '05/08/2026', assigned: 13, completed: 6, cancelled: 0, exchanged: 0, pending: 7, redo: 1, ldt: 1, mileage: 189.4 },
				{ date: '05/11/2026', assigned: 11, completed: 4, cancelled: 1, exchanged: 0, pending: 6, redo: 0, ldt: 0, mileage: 98.2 },
				{ date: '05/12/2026', assigned: 10, completed: 4, cancelled: 0, exchanged: 0, pending: 6, redo: 1, ldt: 0, mileage: 167.5 },
				{ date: '05/13/2026', assigned: 12, completed: 6, cancelled: 0, exchanged: 0, pending: 6, redo: 0, ldt: 0, mileage: 121.3 },
				{ date: '05/14/2026', assigned: 13, completed: 5, cancelled: 1, exchanged: 0, pending: 7, redo: 1, ldt: 0, mileage: 156.7 },
				{ date: '05/15/2026', assigned: 15, completed: 6, cancelled: 0, exchanged: 0, pending: 9, redo: 1, ldt: 1, mileage: 234.2 },
				{ date: '05/18/2026', assigned: 12, completed: 5, cancelled: 0, exchanged: 0, pending: 7, redo: 0, ldt: 0, mileage: 143.6 },
				{ date: '05/19/2026', assigned: 11, completed: 0, cancelled: 0, exchanged: 0, pending: 11, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'Kemuel Tamayo', assigned: 58, completed: 26, cancelled: 2, exchanged: 0, pending: 30, redo: 2, ldt: 2, mileage: 512.3 },
				{ name: 'Jonathon Allen', assigned: 52, completed: 20, cancelled: 1, exchanged: 0, pending: 31, redo: 2, ldt: 1, mileage: 421.7 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-5001', technician: 'Kemuel Tamayo', date: '05/06/2026', status: 'Completed', mileage: 21.4 },
				{ workOrderNum: 'WO-2026-5002', technician: 'Jonathon Allen', date: '05/06/2026', status: 'Completed', mileage: 18.9 },
				{ workOrderNum: 'WO-2026-5003', technician: 'Kemuel Tamayo', date: '05/07/2026', status: 'Completed', mileage: 23.1 },
				{ workOrderNum: 'WO-2026-5004', technician: 'Jonathon Allen', date: '05/07/2026', status: 'Completed', mileage: 19.7 },
				{ workOrderNum: 'WO-2026-5005', technician: 'Kemuel Tamayo', date: '05/08/2026', status: 'Completed', mileage: 16.8 }
			]
		},
		'Tallahassee': {
			location: 'Tallahassee',
			startDate: '2026-05-06',
			endDate: '2026-05-19',
			activityByDate: {
				6: { ASG: 11, CMP: 5, CAN: 0, RRR: 1, LDT: 1 },
				7: { ASG: 9, CMP: 4, CAN: 1, RRR: 0, LDT: 0 },
				8: { ASG: 10, CMP: 5, CAN: 0, RRR: 0, LDT: 1 },
				11: { ASG: 8, CMP: 3, CAN: 0, RRR: 1, LDT: 0 },
				12: { ASG: 9, CMP: 4, CAN: 0, RRR: 0, LDT: 0 },
				13: { ASG: 10, CMP: 5, CAN: 0, RRR: 1, LDT: 0 },
				14: { ASG: 11, CMP: 4, CAN: 1, RRR: 0, LDT: 0 },
				15: { ASG: 12, CMP: 5, CAN: 0, RRR: 1, LDT: 1 },
				18: { ASG: 9, CMP: 4, CAN: 0, RRR: 0, LDT: 0 },
				19: { ASG: 8, CMP: 0, CAN: 0, RRR: 0, LDT: 0 }
			},
			dailyData: [
				{ date: '05/06/2026', assigned: 11, completed: 5, cancelled: 0, exchanged: 0, pending: 6, redo: 1, ldt: 1, mileage: 178.2 },
				{ date: '05/07/2026', assigned: 9, completed: 4, cancelled: 1, exchanged: 0, pending: 4, redo: 0, ldt: 0, mileage: 112.3 },
				{ date: '05/08/2026', assigned: 10, completed: 5, cancelled: 0, exchanged: 0, pending: 5, redo: 0, ldt: 1, mileage: 145.7 },
				{ date: '05/11/2026', assigned: 8, completed: 3, cancelled: 0, exchanged: 0, pending: 5, redo: 1, ldt: 0, mileage: 89.1 },
				{ date: '05/12/2026', assigned: 9, completed: 4, cancelled: 0, exchanged: 0, pending: 5, redo: 0, ldt: 0, mileage: 134.5 },
				{ date: '05/13/2026', assigned: 10, completed: 5, cancelled: 0, exchanged: 0, pending: 5, redo: 1, ldt: 0, mileage: 98.3 },
				{ date: '05/14/2026', assigned: 11, completed: 4, cancelled: 1, exchanged: 0, pending: 6, redo: 0, ldt: 0, mileage: 121.8 },
				{ date: '05/15/2026', assigned: 12, completed: 5, cancelled: 0, exchanged: 0, pending: 7, redo: 1, ldt: 1, mileage: 189.2 },
				{ date: '05/18/2026', assigned: 9, completed: 4, cancelled: 0, exchanged: 0, pending: 5, redo: 0, ldt: 0, mileage: 112.4 },
				{ date: '05/19/2026', assigned: 8, completed: 0, cancelled: 0, exchanged: 0, pending: 8, redo: 0, ldt: 0, mileage: 0 }
			],
			techData: [
				{ name: 'Rocky Deles', assigned: 45, completed: 20, cancelled: 1, exchanged: 0, pending: 24, redo: 2, ldt: 2, mileage: 387.6 }
			],
			completedTickets: [
				{ workOrderNum: 'WO-2026-6001', technician: 'Rocky Deles', date: '05/06/2026', status: 'Completed', mileage: 18.3 },
				{ workOrderNum: 'WO-2026-6002', technician: 'Rocky Deles', date: '05/07/2026', status: 'Completed', mileage: 22.1 },
				{ workOrderNum: 'WO-2026-6003', technician: 'Rocky Deles', date: '05/08/2026', status: 'Completed', mileage: 15.7 },
				{ workOrderNum: 'WO-2026-6004', technician: 'Rocky Deles', date: '05/11/2026', status: 'Completed', mileage: 19.4 },
				{ workOrderNum: 'WO-2026-6005', technician: 'Rocky Deles', date: '05/12/2026', status: 'Completed', mileage: 17.8 }
			]
		}
	}
};

// Expose to window for access from data service and other scripts
window.tarDummyData = tarDummyData;
